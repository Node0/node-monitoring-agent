"use strict";
var fs = require("fs"),
    os = require("os"),
    https = require('https'),
    helmet = require('helmet'),
    express = require("express"),
    sh = require("child_process"),
    bodyParser = require('body-parser'),
    crate = require('node-crate'),
    apiPrefix = '/api/v1',
    execS = sh.execSync;

// Establish connection to crate database
crate.connect ('localhost', 4200);
// sage analytics api port
var port = 7500;
// Start express
var app = express();
// Start the router
var route = express.Router();
// Configure our API prefix
app.use( apiPrefix, route );

// Spin up body-parser
route.use(bodyParser.json());
route.use(bodyParser.urlencoded({ extended: true }));

// SSL certs are stored in this file at the very bottom
// hooray for function hoisting, also buffers rock!
var secureServer = https.createServer({ key: getSSLKey(), cert: getSSLCert() }, app)
    .listen( port, function () { console.log( 'Secure Server listening on port ' + port ); });
// Tighten up a bunch of other loose ends.
app.use(helmet());
// Kill all caching
app.use(helmet.noCache({ noEtag: true }) );
// Set strict transport security
app.use(helmet.hsts({ maxAge: ((86400*1000)*90), force: true }) );
// Disable the express server header
app.disable('x-powered-by');

// Route all Traffic through https, order is important (this should be the first route)
route.all('*', function(req, res, next){
    if (req.secure) {
        return next();
    };
    res.redirect('https://monitoring.appName.com:'+port+req.url);
});


// The the main report endpoint of our serverstat agent
// Always place the more specific routes before the shorter
// and more general ones.
route.post('/set/agentheartbeat', auth, storeAgentHeartBeat);
route.use( '/', healthCheck);




// =============== Begin Implementation ===============

function healthCheck(req, res) {
    res.sendStatus(200);
    //console.log(req.body);
    res.end();
}

function storeAgentHeartBeat ( req, res ) {
    var dbPayload = req.body;
    dbPayload['time'] = Number((new Date().getTime()).toFixed(0));
    crate.insert('live_agents', dbPayload).success( function (o){ /*console.log("Processed " + o.rowcount + " agent heartbeat.");*/ });
    //console.log(JSON.stringify(dbPayload));
    res.sendStatus(200);
    res.end();
}


function storeServerStatObject( resBody ) {
    var sStatObj = resBody,
        dbPayload;
//One timestamp for all objects, from one clock thus ensuring relatively tight time-correlation of events.
    sStatObj['time'] = Number((new Date().getTime()).toFixed(0));
    dbPayload = sStatObj;
    //console.log(dbPayload);
    crate.insert('serverstat', dbPayload).success( function (o){ /* console.log("Stored " + o.rowcount + " serverStat Objects.");*/ });
}


// Configuration object where all dispatched functions
// may be listed with any arguments organized by function.
var use = {
    funcName : {
        args : {
            v0 : "first arg to function.",
            v2 : "second arg to function"
        }
    }

};



// ====================== Begin main timing loop where all tasks are dispatched ======================
setInterval( chronoHub, 1000, use );
var counter = 1;
function chronoHub(use) {


    // Run tasks in following block once per second
    if ( Boolean(counter % 1 === 0)  ) {
        // Ask CrateDB for a unique list of IPs added to the live agents table in the last 30 seconds only.
        let query = 'SELECT DISTINCT public_ipv4 FROM "doc"."live_agents" WHERE time < ( CURRENT_TIMESTAMP ) AND time > ( CURRENT_TIMESTAMP - 50000 ) limit 3000';
        crate.execute(query).success( function (resultSet) {
            getServerStatReports(resultSet.rows);
        });
    }

    // Run tasks in following block once every 6 seconds
    if ( Boolean(counter % 6 === 0)  ) {
        // TODO
        // Ask CrateDB for a unique list of IPs added to the live agents table in the last 30 seconds only.
        // Write query which will fetch list of API testing agents, and then call function which will
        // send list of URLs to test out to them all, collect their responses and store the results.
    }

    counter++;
}




function getServerStatReports(serverStatAgentIpList) {
// Prepping most of the https options object outside the loop.
    var resBody,
        req,
        options = {
            port: 7500,
            path: '/api/v1/get/serverstat',
            method: 'GET',
            rejectUnauthorized: false,
            key: getSSLKey(),
            cert: getSSLCert(),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + new Buffer(''+getCreds('user')+':'+getCreds('pass')+'').toString('base64')
            }
        };
    for (var i = 0, z = serverStatAgentIpList.length; i < z; i++) {

        //Fire off a request 'i' number of times (once per autodiscovered agent)
        options.hostname = serverStatAgentIpList[i].toString(),
            req = https.request(options, function (res) {
                //console.log('STATUS: ' + res.statusCode);
                //console.log('HEADERS: ' + JSON.stringify(res.headers));
                res.setEncoding('utf8');
                res.on('data', function ( resBody ) {
                    if ( resBody !== undefined ) {
                        storeServerStatObject(JSON.parse(resBody)); }
                });
                res.on('end', function (ev) {  if ( ev !== undefined ) {console.log(ev);}  });


            });
        req.on('error', function (e) { /*console.log('problem with request: ' + e.message );*/ });
        req.end();

    }
}
















// Nice and tidy Vanilla JS Auth
function auth(req, res, cb) {
    // -----------------------------------------------------------------------
    // Authentication
    const auth = { login: getCreds('user'), password: getCreds('pass') };
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = new Buffer(b64auth, 'base64').toString().split(':');
    // Check that the login / pass are present
    if (!login || !password || login !== auth.login || password !== auth.password) {
        res.set('WWW-Authenticate', 'Basic realm="Authorization Required"');
        res.status(401).send('Unauthorized Access Denied!');
        return;
    } else {
        return cb();
    }
}


function getCreds(token) {
    if (token === 'user') {
        return 'monitoringapi';
    }
    if ( token === 'pass' ) {
        return '8cd6a37a0a361791f273cd6b7d8139022271c557';
    }
}

function getSSLCert() {
    var sslCert =
        `-----BEGIN CERTIFICATE-----
MIIDCzCCAfOgAwIBAgIJAMYJltRQ+3RIMA0GCSqGSIb3DQEBCwUAMBwxGjAYBgNV
BAMMEXNhZ2UudmVub20zNjAuY29tMB4XDTE2MDQyMDAzNDQ1N1oXDTI2MDQxODAz
NDQ1N1owHDEaMBgGA1UEAwwRc2FnZS52ZW5vbTM2MC5jb20wggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQDYiw1ocWM2irjhoItx2dk1kKL74uTvyuwbN6Q8
d0rEg3ksNj8u9V5gEpYMi/SbGQA2LyqxUo+FFWgUUfShKf8gUcEodtPqL3qhJYsp
CRZl8X2R1F9tiBuRdPG+cwIL8hLR6Jb4NKmbw1MA8zCgC6sl4Fx4bd4u8kybGYW2
kzGRmcJBt27r8+Zx4SFPMWDfblWzPXq91/IqiabrFufD34y0D5uihcYRKtFPDeek
T/YLxLNaZHPiDY7LfB188ugBpgh5Qmc7OP1JnBJEERBn0w5uBFd6742w1q7AONv/
ELL67vFjIGFjc73mUvEjkAkvJJbav5eABDjazratSeo5QwdlAgMBAAGjUDBOMB0G
A1UdDgQWBBQzx82hq08bUJrmLKb/fYjLx2q7GDAfBgNVHSMEGDAWgBQzx82hq08b
UJrmLKb/fYjLx2q7GDAMBgNVHRMEBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQDQ
Pfj4IS84SV5smdaSWU0kUacjXI5A6+g+WpD3849f3iOhIUEtUF5TgWS+zb4qnmrB
BrGWeU3+IXUDDuQbwDZ3Xhbh1MwBQqvbw0oUsAXOtvcaHPsq5Y348FxKQmagiGEP
MNaPPaD5QR8BGekTlXdTtW0atow3aCUv72uFjXtFF2E2MWlMscGZ9JvceAvGOpXX
9/kzMpk1SldVpK2ydMRvCyfS35Dny7Nk69Y8hwINKNhpAiDioV8Moz1DFk0RF/+Y
py/3tHqG12IDFTPKxJ71eiEW22ew0qIhK+dQKll0PtsZ0qzizTsHTaegbuBMRvYz
IreQ+yV5jHOdES+xf/wR
-----END CERTIFICATE-----
`;
    return new Buffer(sslCert, "binary");
}


function getSSLKey() {
    var sslKey =
        `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYiw1ocWM2irjh
oItx2dk1kKL74uTvyuwbN6Q8d0rEg3ksNj8u9V5gEpYMi/SbGQA2LyqxUo+FFWgU
UfShKf8gUcEodtPqL3qhJYspCRZl8X2R1F9tiBuRdPG+cwIL8hLR6Jb4NKmbw1MA
8zCgC6sl4Fx4bd4u8kybGYW2kzGRmcJBt27r8+Zx4SFPMWDfblWzPXq91/Iqiabr
FufD34y0D5uihcYRKtFPDeekT/YLxLNaZHPiDY7LfB188ugBpgh5Qmc7OP1JnBJE
ERBn0w5uBFd6742w1q7AONv/ELL67vFjIGFjc73mUvEjkAkvJJbav5eABDjazrat
Seo5QwdlAgMBAAECggEAcwHPOjRWhCZDMRoqVWplUWyjE3KbMrwsj/wKT07wN9S3
64JYJmGNIStd5AYFAMbTdPOyEgGOVhlbcMdiTKJYbNre4tXRkSRsVd/xu/amnbgX
f/cyQ6MxORzKM+MzKBMGadPFMsgNeLvRfsSqg6YO3Qv/MLrxcS+g/hMdEC22+uOb
vizU8vafNZWcIJB4mbTvKQNL/yOD8liKXkdJ/8djWi6MWHzEkhlWNpWvGRSoAj87
3hQdl5NyhdVXF1jhbcuFdjQOtt7KHJlv7n1uZ7j96JpROQ7ivE6SYPPNPJBsYKAP
9ZlCO8JUgNpPXmgyXvoKnvensDJlYzuPaJT4mlM9tQKBgQDw1mHOmF4wIxw4vMWV
i8nsi0qeZmb9iljPxpO/N9akPwhxGgBWWpb9pw6jXKAbKBrgl4roM7dR1wO/BzuC
8qWeklQ1rtcOuJmVk7QHAGGjjePFxFP+i7Fx3m3+4ALX4X8H8L5m/GsRXVRiGM3H
fGx4l/qYqLH7fm8Hl7s7g6Ut9wKBgQDmLR2agMLrzEYGXXn85aWJeyDqqmSKO0sg
8yYvDFZRGP9hfuo7698OoqLew0tSL4E1gURL1fyNbBchlCiFb99jd/bQZDTpvSJ9
zrEvK4jw5Bykmup2oyk72xdB0jS0Xk/glFD9W+bgZI1wjQnQQ1tEKuiLQORchMga
bzeqfE8OgwKBgQCp3nxULNJaX5lbR4KRjWyaRFEYUqAX+snTm3vAptDlPnRk2fMc
9X6EYJ2Jih5/qRT0Ds9yInAN8Ht69M37+cvpgcqVpsGXZ4sknm6fdZxosP7UEjsw
UjWRXFL3L+exfyKLZjnWB/o44DxRiK80IkWb9Y5SuMH44l/L2jC8tIkAVwKBgC/6
xYn4PylhylL3Vz9VK11uEh14aT67P1zd8l6qRq/e8xUCnJbjAvsNAcBHm0LFbjyV
9oOMVnmwR14TgSLXgAw+7G7iBHmYmED7PcnkXEZCdooFVMxoFGdKsx1gUOYsJqBc
qkk1x/mMXENS0vHbqIGcJB8q5q82anPALS1Xfi87AoGBAIECfnmRg0MM1noSMYDE
psZ+D74HQ0ujS1RjIhULmcJlRAr6S1bIaQiEufSawr7vr67hQKaVVdQb1Po3A9EK
41Y43HPCvJbPHq/2KdGxDfmBUuvs+4mO+/97c1rgrxHipdrvapN+0ySFAVKfEvCf
RHACgxi7CLJdMjPj8gs3zU7B
-----END PRIVATE KEY-----
`;
    return new Buffer(sslKey, "binary");
}