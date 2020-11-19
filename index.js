'use strict'

const db = require('./lib/db');

start();

function start() {
    db.init().then(() => {
      // TODO should this be required at the top?
      const Server = require('./lib/server')
	    new Server().start()
    })
}
