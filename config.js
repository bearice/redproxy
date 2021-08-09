if (process.argv[2]) {
    module.exports = require('./config.' + process.argv[2] + '.json')
} else {
    module.exports = require('./config.json')
}