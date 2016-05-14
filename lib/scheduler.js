'use strict'

/**
 * INDICIES
 *  - (slug, key)
 *  - run_at: -1
 */
class Scheduler {
    
    constructor(server, { db, verbose = true, interval = 300 }) {
	    this.collection = db.collection('events')
        this.interval = interval * 1000 // to millis
        this.server = server
        this.v = verbose
        this.__events = new Map()
        this._init()
    }
    
    add(slug = 'event-slug', key = '', { 
        endpoint, // required
        recurring = false, 
        run_at, // required
        payload = {} 
    } = {}) {
        return this.update(slug, key, {                   // Unique ID (i.e. user's id for their profile notif)
            endpoint: endpoint,         // The URL which to hit (must be via POST)
            recurring: recurring,       // Millis interval for trigger (false for single time)
            run_at: new Date(run_at).getTime(),   // DateTime to run event
            payload: payload            // JSON body to forward to the endpoint
        }, true)
    }
    
    del(slug, key) {
        let hash = `${slug}:${key}`
        if (this.__events.has(hash)) {
            clearTimeout(this.__events.get(hash))
            this.__events.delete(hash)
        }
        return this._del(slug, key)
    }
    
    dispatch({ slug, key, payload, endpoint, run_at, recurring } = {}) {
	let _this = this
        return function() {
	if (this.v) {
            console.log(`Dispatching event ${slug}:${key} to ${endpoint} with the following payload:`)
            console.log(payload)
        }
        _this.__events.delete(`${slug}:${key}`)
        let i = endpoint.indexOf('/')
        let host = endpoint.substr(0, i)
        let path = endpoint.substr(i)
        let port
        
        if (host.includes(':')) {
            [host, port] = host.split(':')
        }
        
        let req = _this.server.request({
            host: host,
            port: port,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, res => {
            let data = ''
            res.on('data', chunk => {
                data += chunk
            })
            res.on('end', () => {
                console.log(data)
                // TODO check for errors
                if (recurring) {
                    _this
                        .update(slug, key, { run_at: run_at + recurring })
                        .then()
                        .catch(err => {
                            console.error(`Error resccheduling event ${slug}:${key}`)
                            console.error(err)
                        })
                } else {
                    _this
                        ._del(slug, key)
                        .then()
                        .catch(err => {
                            console.error(`Error deleting event ${slug}:${key}`)
                            console.error(err)
                        })
                }
                
            })
	   res.on('error', err => {
		console.error(`Error dispatching event ${slug}:${key}`)
		console.error(err) 
	   })
        })
	req.on('error', err => {
		console.error(`Error dispatching event ${slug}:${key}`)
		console.error(err) 
	})
	req.write(JSON.stringify(payload))
	req.end()
    }
}
    
    dispatchAt(event, delay) {
        let hash = `${event.slug}:${event.key}`
        if (this.v) console.log(`Setting event ${hash} to dispatch in ${delay / 1000} seconds`)
        this.__events.set(hash, setTimeout(this.dispatch(event), delay))
    }
    
    get(slug, key) {
        return new Promise((resolve, reject) => {
            this.collection.findOne({
                slug: slug,
                key: key
            }, (err, event) => {
                if (err) return reject(err)
                delete event._id
                resolve(event)
            })
        })
    }
    
    // TODO disallow updating slug or key
    update(slug, key, updates, upsert = false) {
        let hash = `${slug}:${key}`
        if (this.v) console.log(`Updating event ${hash}`)
        
        return new Promise((resolve, reject) => {
            this.collection.findOneAndUpdate({
                slug: slug,
                key: key
            }, {
                $set: updates
            }, {
                upsert: upsert,
		returnOriginal: false
            }, (err, result) => {
                if (err) return reject(err)
		let event = result.value
                delete event._id
                    
                let shouldRunAt = event.run_at + (event.recurring || 0)
                
                if (this.__events.has(hash)) {
                    clearTimeout(this.__events.get(hash))
                    this.__events.delete(hash)
                }
                
                // If the event was set to trigger before the next
                // max interval time (now+interval), dispatch event
                if (shouldRunAt <= this.interval * 1000) {
                    this.dispatchAt(event, event.run_at - Date.now())
                }
                
                resolve(event)
            })
        })
    }
    
    _del(slug, key) {
        if (this.v) console.log(`Adding event ${slug}:${key}`)
        return new Promise((resolve, reject) => {
            this.collection.removeOne({
                slug: slug,
                key: key
            }, (err) => {
                if (err) reject(err)
                else resolve({ deleted: true })
            })
        })
    }
    
    _fetch() {
        this.collection.find({
            run_at: {
                $lte: Date.now() + this.interval
            }
        }).toArray((err, events) => {
            if (err) {
                console.error('Error fetching events')
                return console.error(err)
            }

            if (this.v) console.log(`Dispatching ${events.length} events`)
            
            let now = Date.now()
            events.forEach(e => {
                this.dispatchAt(e, e.run_at - now)
            })
        })
    }
    
    _init() {
        this.collection.createIndexes([
            {
                name: 'index-unique-event',
                unique: true,
                key: {
                    slug: 1,
                    key: 1
                }
            },
            {
                name: 'index-reverse-cron',
                key: {
                    run_at: -1
                }
            }
        ], (err, result) => {
            if (err) throw err
            this._fetch()
            this.__timer = setInterval(this._fetch, this.interval)
        })
    }
}

module.exports = Scheduler
