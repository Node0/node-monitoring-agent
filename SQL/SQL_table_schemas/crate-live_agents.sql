CREATE TABLE LIVE_AGENTS (
  time TIMESTAMP,
  instance_id STRING,
  agent_type STRING,
  ami_id STRING,
  availability_zone STRING,
  public_ipv4 IP,
  private_ipv4 IP
) CLUSTERED INTO 4 shards WITH (
  number_of_replicas = 1,
  refresh_interval = 500);
