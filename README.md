## Demos

Showing how to inspect the entire io.js stack.

## Building io.js in Debug Mode

### clone it first

```sh
https://github.com/iojs/io.js
cd io.js
git checkout v1.x
```

### build the fast way

```sh
brew install ninja

./configure --xcode --without-snapshot
tools/gyp_node.py -f ninja
ninja -C out/Debug

ln -s out/Debug/iojs iojs_g
```

### build the slow way

```sh
./configure --xcode --without-snapshot
make -j8 iojs_g
```

## Building io.js in **Release** mode

### build the fast way

```sh
ninja -C out/Release
ln -s out/Release/iojs iojs
```

### build the slow way

```sh
make -j8 iojs
```

## Install Prerequisites

```
npm install -g resolve-jit-symbols cpuprofilify traceviewify
```

As a result you will find the following commands in your path:

- `rjs` resolve-jit-symbols cli
- `profile_1ms.d` profiling DTrace script
- `cpuprofilify` converts `dtrace`, `perf` and othero out put to `.cpuprofile` format
- `traceviewify` converts `.cpuprofile` into trace-viewer format to load it into chrome://tracing

### Fiboncacci v8-profiler

```sh
# Terminal A
V8PROFILE=1 iojs fibonacci.js

# Terminal B

## ./fibonacci/profile-v8.sh
/
## get everything initialized           \
curl localhost:8000/1000 &&             \
                                        \
## start profiler                       \
curl localhost:8000/start &&            \
                                        \
## fire away while profiling            \
ab -n 1000 -c 20 http://:::8000/1000 && \
                                        \
## kill app and have it write profile   \
kill <pid>
```

- load into DevTools
- load into flamegraph
  - large `program` section which is io.js startup (C/C++)
  - not a problem here since our bottleneck for handling requests is in JS land

### External Request Culprit

#### Initial attempt the way used previously

```sh
# Terminal A
V8PROFILE=1 iojs app.js

# Terminal B (or the browser)

## ./external-request/profile-v8.sh

## get everything initialized
curl localhost:8000 &&                   \
                                         \
## start profiler                        \
curl localhost:8000/start &&             \
                                         \
## request page 3 times while profiling  \
ab -n 3 -c 1 http://:::8000/             \
                                         \
## kill app and have it write profile    \
kill <pid>
```

- load into flamegraph to see that data isn't helping very much (97.9%) is `program`

#### Attempt using system tools

- *at this point we recall that our admin told us that we're making a bunch of outbound calls to github in production*

- [DTrace resource](https://wiki.freebsd.org/DTrace/One-Liners) from which the below one-liner came

#### Identify Bottleneck

- assumes you did the following first

```sh
npm i -g cpuprofilify traceviewify
```

```sh
# Terminal A
iojs --perf-basic-prof app.js

# Terminal B

## ./external-request/profile.sh
# profile with DTrace script installed via cpuprofilify
sudo profile_1ms.d -x switchrate=1000hz -p $1                               | \
                                                                              \
# run through cpuprofilify to resolve symbols and convert to cpuprofile
  cpuprofilify                                                              | \
                                                                              \
# save to file and pipe through
 tee samples.cpuprofile                                                     | \
                                                                              \
# convert cpuprofile to trace-viewer format
  traceviewify > samples-traceview.json &

## request page 3 times while profiling
ab -n 3 -c 1 http://:::8000/ &&                           \
                                                          \
## kill process to have it write /tmp/perf-<pid>.map file
sudo kill <pid>

```

Now we can inspect `samples.cpuprofile` inside Chrome DevTools and the [flamegraph
app](http://thlorenz.github.io/flamegraph/web/) and `samples-traceview.json` inside
[chrome://tracing](chrome://tracing).

We realize we have a bottleneck in ...

##### Count TCP received messages by remote IP address:

```
# Count TCP received messages by remote IP address:
➝  sudo dtrace -n 'tcp:::receive { @[args[2]->ip_saddr] = count(); }'
dtrace: description 'tcp:::receive ' matched 1 probe
^C

  54.211.13.202                                                     2
  199.16.156.48                                                     3
  74.125.226.73                                                     9
  23.235.39.133                                                  3454
```

Who is `23.235.39.133` and why are we getting packets from there?

##### Get Trace for the Connection

Using a slight adaptation of Brendan Gregg's script to [trace the `connect` system
call](http://dtracebook.com/index.php/Network_Lower_Level_Protocols:soconnect.d#Mac_OS_X) we can trace external
connections.

Running it:

```sh
# Terminal A
sudo ./soconnect.d -c 'iojs --perf-basic-prof app.js' > soconnect.txt

# Terminal B
curl localhost:8000

sudo kill <pid>

cat soconnect.txt | rjs /tmp/perf-<pid>.map
```

Resolved stack:

```txt
PID    PROCESS          FAM ADDRESS          PORT   LAT(us) RESULT
20825  iojs             2   23.235.39.133    443         53 In progress

              libsystem_kernel.dylib`__connect+0xa
              iojs`node::TCPWrap::Connect(v8::FunctionCallbackInfo<v8::Value> const&)+0x1cf
              iojs`v8::internal::FunctionCallbackArguments::Call(void (*)(v8::FunctionCallbackInfo<v8::Value> const&))+0x9f
              iojs`v8::internal::Builtin_HandleApiCall(int, v8::internal::Object**, v8::internal::Isolate*)+0x21d
              0xd629eb060bb Stub:CEntryStub
              0xd629ec6b124 LazyCompile:~connect net.js:761
              0xd629ec6aaee LazyCompile:~ net.js:900
              0xd629eb24bc6 Builtin:FunctionApply
              0xd629ec6a76c LazyCompile:~asyncCallback dns.js:59
              0xd629eb1ea55 Builtin:ArgumentsAdaptorTrampoline
              0xd629ec6a629 LazyCompile:~onlookup dns.js:73
              0xd629eb1f0c0 Builtin:JSEntryTrampoline
              0xd629eb1dff1 Stub:JSEntryStub
              iojs`v8::internal::Invoke(bool, v8::internal::Handle<v8::internal::JSFunction>, v8::internal::Handle<v8::internal::Object>, int, v8::internal::Handle<v8::internal::Object>*)+0x238
              iojs`v8::Function::Call(v8::Handle<v8::Value>, int, v8::Handle<v8::Value>*)+0xc1
              iojs`node::AsyncWrap::MakeCallback(v8::Handle<v8::Function>, int, v8::Handle<v8::Value>*)+0x21d
              iojs`node::cares_wrap::AfterGetAddrInfo(uv_getaddrinfo_s*, int, addrinfo*)+0x22b
              iojs`uv__work_done+0xaf
              iojs`uv__async_event+0x3e
              iojs`uv__async_io+0x88
              iojs`uv__io_poll+0x62d
              iojs`uv_run+0x114
              iojs`node::Start(int, char**)+0x2a5
              iojs`start+0x34
              iojs`0x3
```

Interestingly enough the port is `443` so some `https` request is being made here.

Looks like we gotta hook into DNS lookup to trace back to our code:

Very simple DTrace script:

```awk

/*
int uv_getaddrinfo(uv_loop_t* loop,
                   uv_getaddrinfo_t* req,
                   uv_getaddrinfo_cb cb,
                   const char* hostname,
                   const char* service,
                   const struct addrinfo* hints)
*/

pid$target::uv_getaddrinfo:entry {
  printf("%s: hostname: %s", execname, copyinstr(arg3));
  ustack(1000);
}
```

```sh
# Terminal A
sudo ./dns_addrinfo.d -c 'iojs --perf-basic-prof app.js' > dns_addrinfo.txt

# Terminal B
curl localhost:8000

sudo kill <pid>

cat dns_addrinfo.txt | rjs /tmp/perf-<pid>.map > dns_addrinfo.resolved.txt
```

Resolved stack:

```txt
CPU     ID                    FUNCTION:NAME
  4  17402             uv_getaddrinfo:entry iojs: hostname: raw.githubusercontent.com
              iojs`uv_getaddrinfo
              iojs`node::cares_wrap::GetAddrInfo(v8::FunctionCallbackInfo<v8::Value> const&)+0x262
              iojs`v8::internal::FunctionCallbackArguments::Call(void (*)(v8::FunctionCallbackInfo<v8::Value> const&))+0x9f
              iojs`v8::internal::Builtin_HandleApiCall(int, v8::internal::Object**, v8::internal::Isolate*)+0x21d
              0xe0c630060bb Stub:CEntryStub
              0xe0c6315759b LazyCompile:~lookup dns.js:87
              0xe0c63154852 LazyCompile:~Socket.connect net.js:829
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c6314b117 LazyCompile:~exports.connect _tls_wrap.js:798
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c6314a2f5 LazyCompile:~createConnection https.js:43
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c63147f94 LazyCompile:~Agent.createSocket _http_agent.js:158
              0xe0c6314690d LazyCompile:~Agent.addRequest _http_agent.js:114
              0xe0c63142784 LazyCompile:~ClientRequest _http_client.js:18
              0xe0c6301eda5 Builtin:JSConstructStubGeneric
              0xe0c631411e5 LazyCompile:~exports.request http.js:29
              0xe0c631380f7 LazyCompile:~exports.request https.js:110
              0xe0c63137e2d LazyCompile:~exports.get https.js:120
              0xe0c63137ce9 LazyCompile:~getTipOfTheDay /Volumes/d/dev/talks/debugging-profiling-io.js/demos/external-request/app.js:60
              0xe0c631306c1 LazyCompile:~onRequest /Volumes/d/dev/talks/debugging-profiling-io.js/demos/external-request/app.js:85
              0xe0c630812ec LazyCompile:~emit events.js:58
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c6312eeaf LazyCompile:~parserOnIncoming _http_server.js:398
              0xe0c6312c3da LazyCompile:~parserOnHeadersComplete _http_common.js:42
              0xe0c6301f0c0 Builtin:JSEntryTrampoline
              0xe0c6301dff1 Stub:JSEntryStub
              iojs`v8::internal::Invoke(bool, v8::internal::Handle<v8::internal::JSFunction>, v8::internal::Handle<v8::internal::Object>, int, v8::internal::Handle<v8::internal::Object>*)+0x238
              iojs`v8::Function::Call(v8::Handle<v8::Value>, int, v8::Handle<v8::Value>*)+0xc1
              iojs`node::Parser::on_headers_complete_()+0x1f3
              iojs`http_parser_execute+0x319
              iojs`node::Parser::Execute(v8::FunctionCallbackInfo<v8::Value> const&)+0x106
              iojs`v8::internal::FunctionCallbackArguments::Call(void (*)(v8::FunctionCallbackInfo<v8::Value> const&))+0x9f
              iojs`v8::internal::Builtin_HandleApiCall(int, v8::internal::Object**, v8::internal::Isolate*)+0x21d
              0xe0c630060bb Stub:CEntryStub
              0xe0c6312b7b7 LazyCompile:~socketOnData _http_server.js:318
              0xe0c63081287 LazyCompile:~emit events.js:58
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c6312ae5c LazyCompile:~readableAddChunk _stream_readable.js:119
              0xe0c6312a8d7 LazyCompile:~Readable.push _stream_readable.js:95
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c63128fdd LazyCompile:~onread net.js:487
              0xe0c6301ea55 Builtin:ArgumentsAdaptorTrampoline
              0xe0c6301f0bc Builtin:JSEntryTrampoline
              0xe0c6301dff1 Stub:JSEntryStub
              iojs`v8::internal::Invoke(bool, v8::internal::Handle<v8::internal::JSFunction>, v8::internal::Handle<v8::internal::Object>, int, v8::internal::Handle<v8::internal::Object>*)+0x238
              iojs`v8::Function::Call(v8::Handle<v8::Value>, int, v8::Handle<v8::Value>*)+0xc1
              iojs`node::AsyncWrap::MakeCallback(v8::Handle<v8::Function>, int, v8::Handle<v8::Value>*)+0x21d
              iojs`node::StreamWrapCallbacks::DoRead(uv_stream_s*, long, uv_buf_t const*, uv_handle_type)+0x276
              iojs`uv__stream_io+0x4f2
              iojs`uv__io_poll+0x62d
              iojs`uv_run+0x114
              iojs`node::Start(int, char**)+0x2a5
              iojs`start+0x34
              iojs`0x3
```

The first piece of our code int the stack is `getTipOfTheDay`, so that is where this request is originating.

It is requesting from `raw.githubusercontent.com` and the `dig` command reveals that this is points to the IP address we
saw earlier.

```sh
➝  dig raw.githubusercontent.com

; <<>> DiG 9.8.3-P1 <<>> raw.githubusercontent.com
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 19134
;; flags: qr rd ra; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 0

;; QUESTION SECTION:
;raw.githubusercontent.com.     IN      A

;; ANSWER SECTION:
raw.githubusercontent.com. 20   IN      CNAME   github.map.fastly.net.
github.map.fastly.net.  14      IN      A       23.235.39.133

```
