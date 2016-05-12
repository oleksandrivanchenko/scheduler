'use strict'

const http = require('http')
const Scheduler = require('./scheduler')

class Server {
    
    constructor({ port = 3000 }) {
        
        this.port = port
        this.scheduler = new Scheduler()
        this.server = http.createServer(this.connect)
    }
    
    connect(req, res) {
        let [slug, key] = req.url.split('/').slice(1, 3)
        
        switch (req.method.toUpperCase()) {
            case 'POST':
                // Create an event
                break
            case 'PUT':
                // Update an event
                break
            case 'GET':
                // Get an event
                break
            default:
                res.statusCode = 400
                return res.end()
        }
        let body = ''
        
        req
            .on('data', b => { body += b })
            .on('end', () => {
                res.statusCode = 200
                console.log(body)
                res.end('SUCCESS')
            })
            .on('error', err => {
                console.error('Error processing request', err)
                res.statusCode = 500
                response.end('Error processing request')
            })
    }
    
    get() {
        
    }
    
    set() {
        
    }
    
    unset() {
        
    }
    
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