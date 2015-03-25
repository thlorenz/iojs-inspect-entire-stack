'use strict';

var PORT = 8000;
var http = require('http');
var https = require('https');
var concatStream = require('concat-stream');

var profiler
if (process.env.V8PROFILE) { 
  profiler = require('v8-profiler');
}

var dictURL = 'https://raw.githubusercontent.com/sujithps/Dictionary/master/Oxford%20English%20Dictionary.txt';

var server = http.createServer();

server
  .on('request', onRequest)
  .on('listening', onListening)
  .listen(PORT);

/// Cleanly shut down process on SIGTERM to ensure that perf-<pid>.map gets flushed
process.on('SIGTERM', onSIGTERM);

function onSIGTERM() {
  // IMPORTANT to log on stderr, to not clutter stdout which is purely for data, i.e. dtrace stacks
  console.error('Caught SIGTERM, shutting down.');
  server.close();

  if (profiler) {
    var cpuprofile = profiler.stopProfiling('external-request');
    require('fs').writeFileSync(
        __dirname + '/app.cpuprofile'
      , JSON.stringify(cpuprofile, null, 2)
      , 'utf8'
    )
  }

  process.exit(0);
}

console.error('pid', process.pid);

function sendError (res, err) {
  console.error(err);
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end(err.toString());
}

function nonEmpty(line) {
  return line && line.trim().length;
}

function randomLine(lines) {
  var idx = Math.floor(Math.random() * lines.length);
  return lines[idx];
}

function getTipOfTheDay(cb) {
  https
    .get(dictURL, function(res) {
      if (res.statusCode !== 200) return cb(new Error('Got status ' + res.statusCode));
      res.pipe(concatStream(onlines));
    })
    .on('error', cb); 

    
  function onlines(buf) {
    var nonEmptyLines = buf.toString().split('\n').filter(nonEmpty);
    var line = randomLine(nonEmptyLines);
    var parts = line.split(' ');
    var word = parts[0];

    var msg = `
      <p>Did you know that 
        <strong> ${ word } </strong>
        means: <pre>${ line.slice(word.length) }?</pre>
      </p>
    `;
    cb(null, msg);
  }
}

function onRequest(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });

  if (req.url === '/start') {
    profiler.startProfiling('external-request');
    return res.end('<p>Profiler started.</p>\r\n');  
  }

  getTipOfTheDay(ontip);
  function ontip(err, msg) {
    if (err) return sendError(res, err);
    var html = `
      <h1>Welcome to the Smarty Pants Site</h1>
      ${ msg }
    `;
    res.end(html + '\r\n');
  }
}

function onListening() {
  console.error('HTTP server listening on port', PORT);
}
