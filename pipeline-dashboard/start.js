// Supervisor — wraps server.js in a child process so the dashboard can
// trigger a full restart from the UI. The child signals the parent via
// process.send({type:"restart"|"shutdown"}).
//
//   node start.js        -> launches server.js as a fork, auto-restarts on
//                           "restart" message, exits on "shutdown" or when
//                           the child exits on its own.
//
// The child auto-detects it is being supervised via process.env.SUPERVISED=1.

const { fork } = require("child_process");
const path = require("path");

const SERVER_PATH = path.join(__dirname, "server.js");

let child = null;
let shouldRestart = false;
let stopping = false;

function launch() {
  shouldRestart = false;
  console.log("[supervisor] starting server.js …");
  child = fork(SERVER_PATH, [], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, SUPERVISED: "1" },
  });

  child.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "restart") {
      console.log("[supervisor] restart requested by child");
      shouldRestart = true;
      try { child.kill(); } catch (_) {}
    } else if (msg.type === "shutdown") {
      console.log("[supervisor] shutdown requested by child");
      stopping = true;
      try { child.kill(); } catch (_) {}
    }
  });

  child.on("exit", (code, signal) => {
    console.log(`[supervisor] child exited (code=${code}, signal=${signal})`);
    if (shouldRestart && !stopping) {
      setTimeout(launch, 300);
    } else {
      process.exit(code || 0);
    }
  });
}

function forwardSignal(sig) {
  stopping = true;
  if (child) {
    try { child.kill(sig); } catch (_) {}
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

launch();
