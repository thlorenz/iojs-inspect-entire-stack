#!/usr/bin/env bash

## get everything initialized 
curl localhost:8000                        && \
                                              \
## start profiler
curl localhost:8000/start                  && \
                                              \
## request page 3 times while profiling
ab -n 3 -c 1 http://:::8000/                  \
                                              \
## kill app and have it write profile
kill $1
