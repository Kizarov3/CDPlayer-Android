const dataHome = () => (process.env.CDPLAYER_HOME || '/data/cdplayer').replace(/\/cdplayer$/, '');
module.exports = {
  platform: () => 'android', type: () => 'Linux', arch: () => 'arm64', release: () => '', hostname: () => 'android',
  homedir: dataHome, tmpdir: () => `${dataHome()}/tmp`, EOL: '\n', cpus: () => [], totalmem: () => 0, freemem: () => 0,
  userInfo: () => ({ username: 'android', homedir: dataHome() }), networkInterfaces: () => ({}),
};
