# node-monitoring-agent
A temporally high resolution Nodejs based montoring system for EC2.  
  
## Crate DB setup.  

#### You'll need to install CrateDB (https://crate.io/download/)  
#### For the purposes of this demonstration you may install the Crate database on the same EC2 machine as  
#### the monitoring server. For production deployments, an independent Crate DB cluster of at least 3 machines is recommended.  
#### to keep things tidy, you can setup an A record using Route53 and point it to a set of private IPs that are the master and master  
#### candidates as configured in `/etc/crate/crate.conf`. It is helpful to have Elasticsearch knowledge when reasoning about CrateDB.  
  
    
#### Utilize the SQL schema files available under: `SQL/SQL_table_schemas` in order to create the tables which the server requires in order to function. You can actually enter this SQL directly from CrateDB's web administration console as it features a nice SQL terminal.  
  
  
    
    
## NodeJS Infrastructure setup instructions.  


### Server setup.  
  
#### 1.) Create an EC2 instance, install node (0.12+), and pm2 globally, Centos is recommended but any modern linux variant will do.

#### 2.) Create a user named: `monitoring-server`.  
####     In the home directory of that user clone this repository, delete the `agent` directory.  
    
#### 3.) Run `npm install` to get the dependencies installed.  
#### 4.) Run `node monitoring-server.js` to startup the server.
  
#### 5.) In production you'll also need to setup a systemd service that starts the server upon startup and monitors it for availability.   
####     PM2 is the recommended process manager to call from systemd for this purpose.
    
    
### Monitoring Agent setup.  
  
#### 1.) You'll be creating an AMI from the results of your configuration of this server, so choose your base EC2 compute node linux distribution and ssh to it.

#### 2.) Create a user named `ec2-agent` on your candidate ec2 machine of choice,  
####     under that home directory create a folder called `agent` copy the contents of the `agent` folder from this repo to that directory.
  
#### 3.) Run `npm install` to get the dependencies installed.
#### 4.) Run `node monitoring-agent.js` to startup the monitoring agent server.  
  
#### 5.) In production you'll also need to setup a systemd service that starts the monitoring agent upon startup.  
####     PM2 is the recommended process manager to call from systemd for this purpose.
