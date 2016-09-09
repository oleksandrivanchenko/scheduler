'use strict'

const Event = require('./event')
const Promise = require('bluebird')
const redis = require('redis')

const REDIS_ZSET = 'scheduler-zset'

class EmptyResultError extends Error {
	constructor() {
		super()
		this.name = 'EmptyResultError'
	}
}

class Scheduler {
    constructor(server, options = {}) {
        this.interval = (options.interval || 300) * 1000 // to millis
        this.server = server
        this.v = options.verbose == null ? true : options.verbose
        
        this.error = (err) => {
            console.error(`Scheduler Error:`)
            console.error(err)
		console.error('Time: ', new Date())
        }
        this.redis = redis.createClient(options.redis)
        this.redis.on('error', this.error)

        this.dispatcher = function() {
            this.redis
                .zrangebyscoreAsync(REDIS_ZSET, 0, Date.now())
                .then(hashes => hashes[0])
                .then(hash => {
                    if (!hash) throw new EmptyResultError()
console.log(`Dispatching ${hash}`)
                    this.dispatcher()
		})
		.catch(EmptyResultError, setTimeout(() => this.dispatcher(), 1000)))
                .catch(err => {
                    this.error(err)
                    this.dispatcher()
                })
        }

        Promise.promisifyAll(this.redis)

        this._init()
    }
    
    add(slug, key, props = {}) {
        props.slug = slug
        props.key = key
        if (!props.run_at) {
            let error = new Error('Missing required field "run_at"')
            error.code = 400
            return Promise.reject(error)
        }
        
        return new Event(props)
            .save()
            .then(event => {
                let now = Date.now()
                if (event.run_at.getTime() <= now + this.interval) {
                    this.dispatchAt(event, event.run_at.getTime() - now)
                }
                return event
            })
    }
    
    del(slug, key) {
        let hash = Event.getHash(slug, key)
        if (this.v) console.log(`Deleting event ${hash}`)
        
        return this.redis
            .delAsync(hash)
            .then(new Event({ slug, key }).destroy)
            .then(event => ({ deleted: event }))
    }
    
    dispatch(event) {
        let { slug, key, payload, fail_count = 0, endpoint, run_at, recurring } = event
        if (this.v) {
            console.log(`Dispatching event ${event.getHash()} to ${endpoint} with the following payload:`)
            console.log(payload)
        }
        
        let _this = this
        let protocol
        if (endpoint.includes('//')) {
            [protocol, endpoint] = endpoint.split('//')
        }
        let i = endpoint.indexOf('/')
        if (i === -1) i = endpoint.length // If / not found, place index at end
        let host = endpoint.substr(0, i)
        let path = endpoint.substr(i)
        let port
        
        if (host.includes(':')) {
            [host, port] = host.split(':')
        }
        
        if (protocol === 'https:') {
            port = 443
        }
        
        let req = this.server.request({
            host: host,
            protocol: protocol,
            port: port,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, res => {
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => responded(data))
            res.on('error', fail)
        })
        req.on('error', fail)
        req.write(JSON.stringify(payload))
        req.end()

        function responded(data) {
            // TODO check for errors+
            (
                recurring ?
                event
                    .recur()
                    .then(event => {
                        let now = Date.now()                        
                        if (event.run_at.getTime() <= now + _this.interval) {
                            _this.dispatchAt(event, event.run_at.getTime() - now)
                        }
                    })
                : 
                _this.del(slug, key)
            )
                .then(() => _this.redis.delAsync(hash))
                .catch(_this.error)
        }
        
        function fail(err) {
            console.error(`Error dispatching event ${event.getHash()}`)
            console.error(err)
            event
                .save({ fail_count: ++fail_count })
                .then()
                .catch(e => { console.error(`Fatal error updating fail count for ${event.getHash()}`, e) })
        }
    }
    
    queueEvents(events = []) {
	if (!Array.isArray(events)) events = [events]
        if (this.v) console.log(`Dispatching ${events.length} events...`)

        let now = Date.now()
	let zadd_params = []
	events.forEach(e => {
		zadd_params.push(Math.max(e.run_at.getTime() - now, 0))
		zadd_params.push(e.getHash())
	})

        this.redis
            .zremAsync([REDIS_ZSET, ...zadd_params.filter((v,i) => i % 2)]) // Filter to get only the hashes
            .then(() => this.redis.zaddAsync([REDIS_ZSET, ...zadd_params]))
            .catch(this.error)
    }
    
    get(slug, key) {
        return Event.fetch(slug, key)
    }
    
    update(slug, key, updates) {
        return new Event({ slug, key })
            .save(updates)
            .then(event => {
                let hash = event.getHash()
                let now = Date.now()

                if (event.run_at.getTime() <= now + this.interval) {
                    this.dispatchAt(event, event.run_at.getTime() - now)
                } else {
                    this.redis
                        .delAsync(hash)
                }
                
                return event
            })
    }
    
    list(before, after) {
        return Event.list(before, after)
    }
    
    _fetch() {
        Event
            .list(Date.now() + this.interval)
            .then(events => this.redis.delAsync([REDIS_ZSET]).then(() => events))
            .then(this.queueEvents.bind(this))
    }
    
    _init() {
        this._fetch()
        this.__timer = setInterval(()=>{this._fetch()}, this.interval)
        this.dispatcher();
        
    }
}

module.exports = Scheduler
