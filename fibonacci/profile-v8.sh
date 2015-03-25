#!/usr/bin/env bash

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
kill $1 
