#!/usr/bin/env bash

# profile with DTrace script installed via cpuprofilify
sudo profile_1ms.d -p $1                                                    | \
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
sudo kill $1 
