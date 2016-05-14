'use strict'

const http = require('http')
const Scheduler = require('./scheduler')
/**
 * TODO
 *  - Handle intervals based on week/day/month/etc (cron time? research other methods)
 *  - Error reporting endpoints
 */

class Server {
    constructor({ port = 3000 } = {}) {
        this.port = port
        
        this.scheduler = new Scheduler(this, arguments[0])
        this.server = http.createServer()
    	this.server.on('request', (req, res) => { this.connect(req, res) })
    }
    
    connect(req, res) {
        let [slug, key] = req.url.split('/').slice(1, 3)
        let body = ''
        
        req
            .on('data', b => { body += b })
            .on('end', process)
            .on('error', error)
        
        let _this = this
        function process() {
            if (body) {
                try {
                    body = JSON.parse(body)
                } catch(e) {
                    res.statusCode = 400
                    return res.end('INVALID JSON')
                }
            }
           
            let promise
            switch (req.method.toUpperCase()) {
                case 'POST':
                    promise = _this.scheduler.add(slug, key, body)
                    break
                case 'DELETE':
                    promise = _this.scheduler.del(slug, key)
                    break
                case 'PUT':
                    promise = _this.scheduler.update(slug, key, body)
                    break
                case 'GET':
                    promise = _this.scheduler.get(slug, key)
                    break
                default:
                    res.statusCode = 400
                    return res.end()
            }
            
            promise
                .then(done)
                .catch(error)
        }
        
        function done(data) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
        }
            
        function error(err) {
            if (err) console.error(err)
            res.statusCode = 500
            res.end('ERROR PROCESSING REQUEST')
        }
    }
    
    request() { return http.request(arguments) }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`Server successfully bound to port ${this.port}`)
        })
    }
    
    stop() {
        this.server.close(() => {
            console.log('Server successfully closed')
        })
    }
}

module.exports = Server
