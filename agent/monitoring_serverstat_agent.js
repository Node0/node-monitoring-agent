"use strict";
var fs = require("fs"),
    os = require("os"),
    https = require('https'),
    helmet = require('helmet'),
    express = require("express"),
    bodyParser = require('body-parser'),
    sh = require("child_process");

var apiPrefix = '/api/v1',
    execS = sh.execSync;



// Begin critical keepalive section

// Grab the JSON object aws makes available on the cli of any instance.
var ec2IdentityDoc = JSON.parse(
    execS('curl -s http://instance-data/latest/dynamic/instance-identity/document').toString());
// Grab the unstructured "loose text" output of ec2metadata from cli
// turn it into an array sans newlines and restringify via join.
var ec2InstanceMeta = execS('ec2metadata').toString().replace(/root\n/,'').split('\n'),
    ec2InstMetaQckScan = ec2InstanceMeta.join(' ');


/* This throbber method runs frequently.
 *  albeit unsyncronized, it allows autodiscovery
 *  to occur back on the server. Any monitoring agent
 *  communicating time-critically or bidirectionally
 *  will have a presence announcement loop like this.
 */
// Start the agent's heartbeat loop, this will transmit the agent's vitals every 4 seconds.
setInterval ( agentHeartbeat, 10000 );
function agentHeartbeat() {
    var agentVitals = {},
        hbPayload;
        agentVitals['agent_type'] = "serverstat",
        agentVitals['ami_id'] = ec2IdentityDoc.imageId,
        agentVitals['instance_id'] = ec2IdentityDoc.instanceId,
        agentVitals['availability_zone'] = ec2IdentityDoc.availabilityZone;

    Object.keys(ec2InstanceMeta).forEach( function (line) {
        if( Boolean(ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)) === true) {
            agentVitals['private_ipv4'] = ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)[2].trim();
        }
        if( Boolean(ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)) === true) {
            agentVitals['public_ipv4'] = ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)[2].trim();
        }
    });
    hbPayload = JSON.stringify(agentVitals);
// Using the core https module
    var options = {
        hostname: 'monitoring.appName.com',
        port: 7500,
        path: '/api/v1/set/agentheartbeat',
        method: 'POST',
        rejectUnauthorized: false,
        key: getSSLKey(),
        cert: getSSLCert(),
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': hbPayload.length,
            'Authorization': 'Basic ' + new Buffer(''+getCreds('user')+':'+getCreds('pass')+'').toString('base64')
        }
    };
    var req = https.request(options, function (res) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (chunk) { /* console.log('BODY: ' + chunk);*/ });
        res.on('end', function () { /*console.log('No more data in response.');*/ });
    });
    req.on('error', function (e) { console.log('problem with request: ' + e.message ); });
// write data to request body
    req.write(hbPayload);
    req.end();

}

// End critical keepalive section


// Begin monitoring agent API section

//Agent_serv IP
var agentServIp = {};
Object.keys(ec2InstanceMeta).forEach( function (line) {
    if( Boolean(ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)) === true) {
        agentServIp['private'] = ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)[2].trim();
    }
    if( Boolean(ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)) === true) {
        agentServIp['public'] = ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)[2].trim();
    }
});
// monitoring analytics api port
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
    res.redirect('https://'+agentServIp['public']+':'+port+req.url);
});


// The the main report endpoint of our serverstat agent
// Always place the more specific routes before the shorter
// and more general ones.
route.get('/get/serverstat', auth, sendServerStatReport);
route.use( '/', healthCheck);

// Quick health check resposne.
function healthCheck(req,res) {
    res.sendStatus(200);
    res.end();
}


// Handle data collection function invocation
// prep and ship payload in response.
function sendServerStatReport(req,res) {
    var serverStatObject = makeServerStatObject(),
        payload = JSON.stringify(serverStatObject);
    res.send(payload);
    res.end();
}


// End monitoring agent API section



// BEGIN serverstat data collection bits
// Note: If cpu usage metrics come up as null for a given system
// that system must have the sysstat package installed, i.e. apt-get install sysstat
// this shouldn't be an issue but the dependency on sysstat is worth noting.
function makeServerStatObject () {
    var serverStatObject = {},
        cpus = os.cpus().length,
        cpuUseArr = execS('tail -n3 /var/log/sar/cpuPercStat.log | grep -Pi "all" | sed -r \'s~(AM|PM)~~\' | awk \'{print $3","$4","$5","$6","$7","$8","$9","$10","$11","$12}\'').toString().trim().split('\n');

    var avgCpuUseArr = [],
        avgCpuStolenArr = [],
        avgCpuIdleArr = [],
        avgCpuTimeUsed,
        avgCpuTimeStolen,
        avgCpuTimeIdle,
        arrLen = cpuUseArr.length;
    for (var i = 0; i < arrLen; i++) {
        avgCpuUseArr.push(
            Number(cpuUseArr[i].split(',')[0])+
            Number(cpuUseArr[i].split(',')[1])+
            Number(cpuUseArr[i].split(',')[2])+
            Number(cpuUseArr[i].split(',')[3])+
            Number(cpuUseArr[i].split(',')[5])+
            Number(cpuUseArr[i].split(',')[6])+
            Number(cpuUseArr[i].split(',')[7])+
            Number(cpuUseArr[i].split(',')[8]));
        avgCpuStolenArr.push( Number(cpuUseArr[i].split(',')[4]) );
        avgCpuIdleArr.push( Number(cpuUseArr[i].split(',')[9]) );
    }

    avgCpuTimeUsed = ((avgCpuUseArr[0]+avgCpuUseArr[1]+avgCpuUseArr[2])/arrLen).toFixed(3);
    avgCpuTimeStolen = ((avgCpuStolenArr[0]+avgCpuStolenArr[1]+avgCpuStolenArr[2])/arrLen).toFixed(3);
    avgCpuTimeIdle = ((avgCpuIdleArr[0]+avgCpuIdleArr[1]+avgCpuIdleArr[2])/arrLen).toFixed(3);
    var load1 = ((os.loadavg()[0]/cpus).toFixed(3)),
        load5 = ((os.loadavg()[1]/cpus).toFixed(3)),
        load15 = ((os.loadavg()[2]/cpus).toFixed(3)),
        totalMem = ((os.totalmem()/Math.pow(10,9)).toFixed(3)),
        freeMem = ((os.freemem()/Math.pow(10,9)).toFixed(3)),
        diskIops = execS("iostat  | grep -Pi 'xvda' | awk '{print $2}'");

    var connsPerSec;
    try {
        connsPerSec = execS('curl -s http://localhost/nx_s').toString().match(/(Active\sconnections\:\s{1,})(\d{1,})/i)[2];
    }
    catch(err) {
        if (err) {
            console.error(err);
            connsPerSec = false;
        }
    }
    finally{
        if (connsPerSec === false) {
            connsPerSec = 0;
        }
    }
// Just the raw bytes in and out
    var netRxTxState = execS('bwm-ng -C, -o csv -c 1 |sudo  tail -n1 |sudo  awk \'BEGIN{FS=","};{print $4","$3}\'').toString().split(',');
// Not paranoia, the server blew up when these were coerced to strings.
// what I wouldn't do for a simple (float) type-cast right about now...
    netRxTxState[0] = Number(netRxTxState[0]);
    netRxTxState[1] = Number(netRxTxState[1]);

// Kilobits per second
    var network_inbound_kbps = Number(((netRxTxState[0]*8)/1000).toFixed(3)),
        network_outbound_kbps = Number(((netRxTxState[1]*8)/1000).toFixed(3)),
// Megabits per second
        network_inbound_mbps = Number(((netRxTxState[0]*8)/1000000).toFixed(3)),
        network_outbound_mbps = Number(((netRxTxState[1]*8)/1000000).toFixed(3)),
// Regex for deriving 1st factor used for inferring server's likely role from it's aws security group membership
// this regex match will result in either serverTypeIs equaling 'www' or 'db'
        serverTypeIs = ec2InstMetaQckScan.match(/(^.+)(appName\-)(www|db)(\-security\-group)(.+$)/i)[3];

// The 2nd factor, look for /var/www/appName/  which is a good indicator that this is not a db machine.
    var vnmWwwDeployChk;
    try {
        vnmWwwDeployChk = fs.statSync('/var/www/appName/.git/');
    }
    catch(err) {
        if (err) {
            console.error(err);
            vnmWwwDeployChk = false;
        }
    }
    finally {
        if (vnmWwwDeployChk === false) {
            console.log("appName not found in /var/www/appName");
        }
    }



    if (serverTypeIs !== 'db' && vnmWwwDeployChk !== false) {
// If both factors support the 'www' machine role, then look for the version of appName on this machine.
        if ( vnmWwwDeployChk.isDirectory() === true && serverTypeIs === 'www' ) {
            var vnmRawVer = execS('cd /var/www/appName; git describe;').toString().trim(),
                vnmVerNum = false,
                vnmBuild  = false;
            if ( Boolean(vnmRawVer.match(/(^\d{1,2}\.\d{1,2}\.\d{1,2})(\-)/)) ) {
                vnmVerNum = vnmRawVer.replace(/(^)(\d{1,2}\.\d{1,2})(\.)(\d{1,2})(\-)(\d{1,2})(.+$)/,'$1$2$4$6');
                vnmBuild  = vnmRawVer.replace(/(^.+)(\-\d{1,2}\-)/,'');
            } else {
                vnmVerNum = vnmRawVer.replace(/(^)(\d{1,2}\.\d{1,2})(\.)(\d{1,2})/,'$1$2$4');
                if ( Boolean(vnmRawVer.match(/(^.+)(\-\d{1,2}\-)(.+$)/)) === false ) {
                    vnmBuild  = "Commit Hash not found";
                }
            }
        }
    }


// Some quick assembly of the all the various metrics
    serverStatObject['server_type'] = (serverTypeIs === 'www') ? 'www' : 'db';
    if (serverTypeIs !== 'www' && serverTypeIs !== 'db' ) { serverStatObject['server_type'] = 'other' };
    serverStatObject['cpu_count'] = Number(cpus);
    serverStatObject['cpu_usage'] = avgCpuTimeUsed;
    serverStatObject['cpu_idle'] = avgCpuTimeIdle;
    serverStatObject['cpu_stolen'] = avgCpuTimeStolen;
    serverStatObject['total_memory'] = Number(totalMem);
    serverStatObject['used_memory'] = Number((totalMem - freeMem).toFixed(3));
    serverStatObject['free_memory'] = Number(freeMem);
    serverStatObject['disk_iops'] = Number(diskIops);
    serverStatObject['load_1'] = Number(load1);
    serverStatObject['load_5'] = Number(load5);
    serverStatObject['load_15'] = Number(load15);
    serverStatObject['conns_per_sec'] = Number(connsPerSec);
    serverStatObject['network_inbound_kbps'] = Number(network_inbound_kbps);
    serverStatObject['network_outbound_kbps'] = Number(network_outbound_kbps);
    serverStatObject['network_inbound_mbps'] = Number(network_inbound_mbps);
    serverStatObject['network_outbound_mbps'] = Number(network_outbound_mbps);
    if (serverTypeIs === 'www') { serverStatObject['appName_www_release'] = vnmRawVer; }
    if (serverTypeIs === 'www') { serverStatObject['appName_www_version'] = Number(vnmVerNum); }
    if (serverTypeIs === 'www') { serverStatObject['appName_www_build']   = vnmBuild; }
    serverStatObject['instance_id'] = ec2IdentityDoc.instanceId;
    serverStatObject['ami_id'] = ec2IdentityDoc.imageId;
    serverStatObject['instance_type'] = ec2IdentityDoc.instanceType;
    serverStatObject['region'] = ec2IdentityDoc.region;
    serverStatObject['availability_zone'] = ec2IdentityDoc.availabilityZone;
    serverStatObject['architecture'] = ec2IdentityDoc.architecture;
    serverStatObject['autoscale_group'] = 'test';
    serverStatObject['autoscale_persist'] = 0;




    /* Lots of regex below, it's what happens when the other source of info we need is a loose text file
     *  its JSON representation would have been nice. So it's either this with 1 call to
     *  http://instance-data/latest/dynamic/instance-identity/document or 7 requests to their api
     *  even with all the regex crunching here, JS is still loads faster internally than all that IO.
     *  Remember, this agent will be reporting all the time, so 70 calls/min is not a good time, 7 calls/min is ok.
     *  I blame crockford for the Boolean checking, as apparently null is the devil.
     */
    Object.keys(ec2InstanceMeta).forEach( function (line) {
        if( Boolean(ec2InstanceMeta[line].match(/(ami\-launch\-index\:)(.+$)/i)) === true) {
            serverStatObject['ami_launch_index'] = Number(ec2InstanceMeta[line].match(/(ami\-launch\-index\:)(.+$)/i)[2]);
        }
        if( Boolean(ec2InstanceMeta[line].match(/(local\-hostname\:)(.+$)/i)) === true) {
            serverStatObject['private_hostname'] = ec2InstanceMeta[line].match(/(local\-hostname\:)(.+$)/i)[2].trim();
        }
        if( Boolean(ec2InstanceMeta[line].match(/(public\-hostname\:)(.+$)/i)) === true) {
            serverStatObject['public_hostname'] = ec2InstanceMeta[line].match(/(public\-hostname\:)(.+$)/i)[2].trim();
        }
        if( Boolean(ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)) === true) {
            serverStatObject['private_ipv4'] = ec2InstanceMeta[line].match(/(local\-ipv4\:)(.+$)/i)[2].trim();
        }
        if( Boolean(ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)) === true) {
            serverStatObject['public_ipv4'] = ec2InstanceMeta[line].match(/(public\-ipv4\:)(.+$)/i)[2].trim();
        }
        if( Boolean(ec2InstanceMeta[line].match(/(reserveration\-id\:)(.+$)/)) ) {
            if(ec2InstanceMeta[line].match(/(reserveration\-id\:)(.+$)/i)[2].trim() === 'unavailable' ) {
                serverStatObject['reservation_id'] = execS('curl -s http://instance-data/1.0/meta-data/reservation-id/').toString().trim();
            } else {
                serverStatObject['reservation_id'] = ec2InstanceMeta[line].match(/(reserveration\-id\:)(.+$)/i)[2].trim();
            }
        }
        if( Boolean(ec2InstanceMeta[line].match(/(security\-groups\:)(.+$)/i)) === true ) {
            serverStatObject['security_groups'] = ec2InstanceMeta[line].match(/(security\-groups\:)(.+$)/i)[2].trim();
        }
    });

// Ok serverStatObject is prepped and ready.
//console.log(serverStatObject);
    return serverStatObject;
}
// END serverstat  data collection bits






// Descent into basement below...


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
        return '8cd6a37a0a361791f273cd6b7d8139022271c557#';
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