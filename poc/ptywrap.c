// ptywrap: minimal PTY bridge for the OpenCode++ embedded server on Android.
// Built with the NDK as libptywrap.so so the package manager extracts it into
// the app's nativeLibraryDir, where exec is allowed on targetSdk 29+.
// Usage: ptywrap COLS ROWS CMD [ARGS...]
//   - child gets a fresh session + controlling PTY (cols x rows), runs CMD
//   - parent pumps: stdin -> master, master -> stdout
//   - fd 3 (optional control pipe): lines "R <cols> <rows>\n" resize the PTY
//   - SIGTERM/SIGINT/SIGHUP forward to the child; exit code = child's exit code
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static pid_t child = -1;
static void forward(int sig) { if (child > 0) kill(child, sig); }

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: ptywrap COLS ROWS CMD [ARGS...]\n"); return 64; }
  int cols = atoi(argv[1]), rows = atoi(argv[2]);
  if (cols <= 0) cols = 80; if (rows <= 0) rows = 24;

  int master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
  if (master < 0) { perror("posix_openpt"); return 70; }
  if (grantpt(master) || unlockpt(master)) { perror("grantpt/unlockpt"); return 70; }
  char *slave_name = ptsname(master);
  if (!slave_name) { perror("ptsname"); return 70; }
  struct winsize ws = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols };
  ioctl(master, TIOCSWINSZ, &ws);

  child = fork();
  if (child < 0) { perror("fork"); return 70; }
  if (child == 0) {
    close(master);
    setsid();
    int slave = open(slave_name, O_RDWR);
    if (slave < 0) _exit(71);
    ioctl(slave, TIOCSCTTY, 0);
    dup2(slave, 0); dup2(slave, 1); dup2(slave, 2);
    if (slave > 2) close(slave);
    execvp(argv[3], &argv[3]);
    perror("execvp");
    _exit(127);
  }

  struct sigaction sa = {0};
  sa.sa_handler = forward;
  sigaction(SIGTERM, &sa, 0); sigaction(SIGINT, &sa, 0); sigaction(SIGHUP, &sa, 0);
  signal(SIGPIPE, SIG_IGN);

  int ctl = 3;
  if (fcntl(ctl, F_GETFD) < 0) ctl = -1;
  struct pollfd fds[3] = {
    { .fd = master, .events = POLLIN },
    { .fd = STDIN_FILENO, .events = POLLIN },
    { .fd = ctl, .events = ctl >= 0 ? POLLIN : 0 },
  };
  char buf[65536], ctlbuf[128]; int ctllen = 0, status = 0, exited = 0;
  while (!exited) {
    int n = poll(fds, 3, 200);
    if (n < 0 && errno != EINTR) break;
    if (n > 0) {
      if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
        ssize_t r = read(master, buf, sizeof(buf));
        if (r > 0) { ssize_t w = write(STDOUT_FILENO, buf, r); (void)w; }
        else if (r <= 0 && (fds[0].revents & (POLLHUP | POLLERR))) fds[0].fd = -1;
      }
      if (fds[1].revents & (POLLIN | POLLHUP)) {
        ssize_t r = read(STDIN_FILENO, buf, sizeof(buf));
        if (r > 0) { ssize_t w = write(master, buf, r); (void)w; }
        else { fds[1].fd = -1; kill(child, SIGHUP); }
      }
      if (ctl >= 0 && (fds[2].revents & POLLIN)) {
        ssize_t r = read(ctl, ctlbuf + ctllen, sizeof(ctlbuf) - 1 - ctllen);
        if (r > 0) {
          ctllen += r; ctlbuf[ctllen] = 0;
          char *nl;
          while ((nl = strchr(ctlbuf, '\n'))) {
            int c2, r2;
            if (sscanf(ctlbuf, "R %d %d", &c2, &r2) == 2 && c2 > 0 && r2 > 0) {
              struct winsize ws2 = { .ws_row = (unsigned short)r2, .ws_col = (unsigned short)c2 };
              ioctl(master, TIOCSWINSZ, &ws2);
              kill(child, SIGWINCH);
            }
            memmove(ctlbuf, nl + 1, ctllen - (nl - ctlbuf) - 1);
            ctllen -= (nl - ctlbuf) + 1;
          }
          if (ctllen >= (int)sizeof(ctlbuf) - 1) ctllen = 0;
        } else if (r == 0) { fds[2].fd = -1; ctl = -1; }
      }
    }
    pid_t w = waitpid(child, &status, WNOHANG);
    if (w == child) {
      // drain remaining PTY output before exiting
      int flags = fcntl(master, F_GETFL); fcntl(master, F_SETFL, flags | O_NONBLOCK);
      ssize_t r;
      while ((r = read(master, buf, sizeof(buf))) > 0) { ssize_t wr = write(STDOUT_FILENO, buf, r); (void)wr; }
      exited = 1;
    }
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 70;
}
