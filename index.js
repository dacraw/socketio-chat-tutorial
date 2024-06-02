import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const db = await open({
  filename: "chat.db",
  driver: sqlite3.Database,
});

await db.exec(`
    create table if not exists messages (
        id integer primary key autoincrement,
        client_offset text unique,
        content text
    );
`);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

io.on("connection", async (socket) => {
  console.log("a user connected");

  socket.on("chat message", async (msg, clientOffset, callback) => {
    let result;
    try {
      result = await db.run(
        `INSERT INTO messages (content, client_offset) VALUES (?, ?)`,
        msg,
        clientOffset
      );
    } catch (e) {
      if (e.errno === 19 /* sql_lite constraint */) {
        // the message was already inserted, so we notify the client
        callback();
      } else {
        // nothing to do, just let the client retry
      }
      return;
    }
    io.emit("chat message", msg, result.lastID);

    callback();
  });

  if (!socket.recovered) {
    try {
      await db.each(
        "SELECT id, content FROM messages WHERE id > ?",
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit("chat message", row.content, row.id);
        }
      );
    } catch (e) {
      console.log("something went wrong: ", e);
    }
  }

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

server.listen(3000, () => {
  console.log("server running at http://localhost:3000");
});
