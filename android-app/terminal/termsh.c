/* libtermsh.so: a shell shim the opencode shell tool runs as SHELL.
 * Android forbids exec of files in app-private storage, so this lives in the native lib dir.
 *
 *   termsh -c "cmd"   ->  proot -r $TERM_ROOTFS ... /bin/(ba)sh -c "cmd"      (rootfs installed)
 *                     ->  /system/bin/sh -c "cmd"                              (no rootfs yet)
 *
 * Env (set by terminal.js): TERM_ROOTFS, TERM_PROOT, TERM_BIND (extra dir bound at the same path),
 * PROOT_LOADER, PROOT_TMP_DIR. Licence of this file: same as the project (MIT).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <errno.h>

static void fallback(char **argv) {
  argv[0] = "sh";
  execv("/system/bin/sh", argv);
  perror("termsh: exec /system/bin/sh");
  _exit(127);
}

static int has(const char *root, const char *rel) {
  char p[PATH_MAX];
  snprintf(p, sizeof p, "%s/%s", root, rel);
  return access(p, X_OK) == 0;
}

int main(int argc, char **argv) {
  const char *root = getenv("TERM_ROOTFS");
  const char *proot = getenv("TERM_PROOT");
  const char *bind = getenv("TERM_BIND");
  if (!root || !proot || access(proot, X_OK) != 0 || !(has(root, "bin/sh"))) fallback(argv);

  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof cwd)) strcpy(cwd, "/");

  const char *sh = has(root, "bin/bash") ? "/bin/bash" : "/bin/sh";
  char **a = calloc((size_t)argc + 40, sizeof(char *));
  int n = 0;
  a[n++] = (char *)proot;
  a[n++] = "-r"; a[n++] = (char *)root;
  a[n++] = "-0";
  a[n++] = "--link2symlink";
  a[n++] = "--kill-on-exit";
  a[n++] = "-L";
  a[n++] = "-b"; a[n++] = "/dev";
  a[n++] = "-b"; a[n++] = "/proc";
  a[n++] = "-b"; a[n++] = "/sys";
  if (bind && *bind) { a[n++] = "-b"; a[n++] = (char *)bind; }
  a[n++] = "-w"; a[n++] = cwd;
  a[n++] = (char *)sh;
  for (int i = 1; i < argc; i++) a[n++] = argv[i];
  a[n] = NULL;

  unsetenv("LD_PRELOAD");
  unsetenv("LD_LIBRARY_PATH");
  setenv("HOME", "/root", 1);
  setenv("USER", "root", 1);
  setenv("LOGNAME", "root", 1);
  setenv("SHELL", sh, 1);
  setenv("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);
  setenv("TERM", getenv("TERM") ? getenv("TERM") : "xterm-256color", 1);
  setenv("LANG", "C.UTF-8", 1);
  /* Many kernels/ROMs break proot's seccomp fast path; slower but safe. */
  if (!getenv("PROOT_NO_SECCOMP")) setenv("PROOT_NO_SECCOMP", "1", 1);

  execv(proot, a);
  fprintf(stderr, "termsh: exec %s: %s\n", proot, strerror(errno));
  fallback(argv);
  return 127;
}
