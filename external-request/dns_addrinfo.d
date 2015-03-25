#!/usr/sbin/dtrace -s

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
