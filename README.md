# node-monitoring-agent
#### A temporally high resolution Nodejs based (Updates at 1 Hz, which cloudwatch does not provide as a matter of course) monitoring system for EC2. I'm perfectly aware that this is niche, and not everybody wants systems data at 1 second resolution, however if you did, here is a relatively straightforward (albeit somewhat of a systems admin & unix'y) way to obtain such data.
  
## Crate DB setup.  

#### You'll need to install CrateDB (https://crate.io/download/)  
#### For the purposes of this demonstration you may install the Crate database on the same EC2 machine as  
#### the monitoring server. For production deployments, an independent Crate DB cluster of at least 3 machines is recommended.  
#### to keep things tidy, you can setup an A record using Route53 and point it to a set of private IPs that are the master and master  
#### candidates as configured in `/etc/crate/crate.conf`. It is helpful to have Elasticsearch knowledge when reasoning about CrateDB.  
  
    
#### Utilize the SQL schema files available under: `SQL/SQL_table_schemas` in order to create the tables which the server requires in order to function. You can actually enter this SQL directly from CrateDB's web administration console as it features a nice SQL terminal.  
  
  
    
    
## NodeJS Infrastructure setup instructions.  


## Server setup.  
  
#### 1.) Create an EC2 instance, install node (0.12+), and pm2 globally, Centos is recommended but any modern linux variant will do.

#### 2.) Create a user named: `monitoring-server`. In the home directory of that user clone this repository, delete the `agent` directory.  
    
#### 3.) Run `npm install` to get the dependencies installed.  
#### 4.) Run `node monitoring-server.js` to startup the server.
  
#### 5.) In production you'll also need to setup a systemd service that starts the server upon startup and monitors it for availability. PM2 is the recommended process manager to call from systemd for this purpose.
    
    
## Monitoring Agent setup.  
  
#### 1.) You'll be creating an AMI from the results of your configuration of this server, so choose your base EC2 compute node linux distribution and ssh to it.  
  
    
#### 2.) Install the `sysstat` package (which provides the `sar` binary), and install the following script under `/etc/init.d/`, alternatively if you're working outside of amazonlinux (centos, ubuntu, etc) it is recommended to create a systemd service which accomplishes the same task as the script included in this repo: https://github.com/Node0/node-monitoring-agent/blob/master/agent/helper_scripts/realtime-sar  The underlying purpose of utilizing `sar` in this manner is to create a deamonized service which is constantly writing cpu statistics (utilizes less than 0.5% of cpu load) to `/var/log/sar/cpuPercStat.log` on the system undergoing monitoring (where the agent is installed), this file acts as a cpu load percentage buffer and the agent 'skims' the last N seconds of cpu statistics (3 seconds is optimal for a clean cpu load signal free of jitter) in the NodeJS code by utilizing `tail -n3` of the `/var/log/sar/cpuPercStat.log` file before piping the lines to awk for preparation into a comma separated textual structure which is processed and then averaged in NodeJS to derive the average CPU load within the last 3 seconds. It would have been nice to have had the time and/or knowldge of linux kernel module creation in order to create a kernal module which reports cpu usage in percentage terms constantly available under `/proc` (`/proc` provides 'ticks', and not results in percentage terms), though I suppose then I might just have well have written a node module that interprets the ticks and provides output in percentage terms, in any case `sar` provides this readily out of the box. A cron job should be setup to truncate the all but the last 3 lines of `/var/log/sar/cpuPercStat.log` every half hour or so.   
   
#### 3.) Install `bwm-ng` in order for the monitoring-agent to be able to query bandwidth usage data on the fly.

#### 4.) Create a user named `ec2-agent` on your candidate ec2 machine of choice, under that home directory create a folder called `agent` copy the contents of the `agent` folder from this repo to that directory.
  
#### 5.) Run `npm install` to get the dependencies installed.
#### 6.) Run `node monitoring-agent.js` to startup the monitoring agent server.  
  
#### 7.) In production you'll also need to setup a systemd service that starts the monitoring agent upon startup. PM2 is the recommended process manager to call from systemd for this purpose. 
  
    
      
        
## Grafana as "View Layer"  
  
#### You can now setup a Grafana server and configure the elasticsearch (or CrateDB if you prefer) datasource, to connect to the database, and write auto-completion enabled, interactive SQL/ES visualization queries to visualize your data, setup your alerting and so on.  
    
      
    
