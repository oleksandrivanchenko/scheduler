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
        let [url, query] = req.url.split('?')
        let [slug, key] = url.split('/').slice(1, 3)
        let body = ''
        
        if (query) {
            let q = {}
            query.split('&').forEach(s => {
                let [key, value] = s.split('=')
                q[key] = value
            })
            query = q
        }
        
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
                
                if (body.run_in) { // run_in (seconds)
                    body.run_at = Date.now() + (body.run_in * 1000)
                    delete body.run_in
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
                    if (slug && key) promise = _this.scheduler.get(slug, key)
                    else if (slug === 'list') promise = _this.scheduler.fetch(query.before, query.after)
                    else {
                        res.statusCode = 404
                        return res.end()
                    }
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
