const qrcode = require("qrcode-terminal");
const mysql = require("mysql");
require("dotenv").config();
const fs = require("fs");
const https = require("https");
const express = require("express");
const multer = require("multer");
const path = require("path");
const basicAuth = require("express-basic-auth");

const filePath = "messages.txt";

var messages = "";

fs.readFile(filePath, "utf8", (err, data) => {
  if (err) {
    console.error("Error reading the file:", err);
    return;
  }
  messages = data.split("\n");
});

function randomMessage() {
  return messages[Math.floor(Math.random() * messages.length)];
}

const dbHost = process.env.DB_HOST;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbDatabase = process.env.DB_DATABASE;
const replyInterval = parseInt(process.env.REPLY_INTERVAL);
const bitrixUrl = process.env.BITRIX_URL;
const bitrixSourceId = process.env.BITRIX_SOURCE_ID;

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("Client is ready!");
});

client.on("message", (message) => {
  message.getChat().then(function (chat) {
    if (!chat.isGroup) {
      checkDBTimestamp(message, function (results) {
        if (results && results.length > 0) {
          if (results[0].timestamp + replyInterval < unixTimestamp()) {
            message.reply(randomMessage());
            updatekDBTimestamp(message, function (results) {});
          } else {
            //Nao manda nada
          }
        } else {
          insertDBTimestamp(message, function (results) {
            message.reply(randomMessage());
            addToBitrix(
              message._data.notifyName,
              message.from.replace("@c.us", ""),
              ""
            );
          });
        }
      });
    }
  });
});

client.initialize();

const app = express();
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },

  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

// Middleware for authentication
app.use(
  basicAuth({
    users: { [process.env.API_USERNAME]: process.env.API_PASSWORD },
    challenge: true,
    unauthorizedResponse: "Authentication failed.",
  })
);

// Endpoint for file upload
app.post("/message", upload.single("file"), (req, res) => {
  const number = req.body.number;
  const message = req.body.message;
  const file = req.file;

  if (number && (file || message)) {
    const numberWithSuffix = number.includes("@c.us")
      ? number
      : `${number}@c.us`;

    if (file) {
      const media = MessageMedia.fromFilePath(file.path);
      client.sendMessage(numberWithSuffix, media);
    }

    if (message) {
      client.sendMessage(numberWithSuffix, message);
    }
  }

  res.send("Received POST message with file");
});

// Endpoint for fetching chats
app.get("/chats", (req, res) => {
  client.getChats().then((chats) => {
    res.json(chats);
  });
});

// Start the server
const port = 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

function checkDBTimestamp(message, callback) {
  const connection = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
  });

  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to the database: " + err.stack);
      return;
    }
    connection.query(
      "SELECT * FROM auto_reply WHERE user = '" + message.from + "'",
      (err, results) => {
        if (err) {
          console.error("Error executing query: " + err.stack);
          connection.end(); // Close the connection in case of an error
          return;
        }
        callback(results);
        connection.end(); // Close the connection after executing the query
      }
    );
  });
}

function updatekDBTimestamp(message, callback) {
  const connection = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
  });

  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to the database: " + err.stack);
      return;
    }

    let newRecord = {
      user: message.from,
      name: message._data.notifyName,
      timestamp: message.timestamp,
    };

    connection.query(
      "UPDATE auto_reply SET ? WHERE user = '" + message.from + "'",
      [newRecord, message.from],
      (err, results) => {
        if (err) {
          console.error("Error executing query: " + err.stack);
          connection.end(); // Close the connection in case of an error
          return;
        }
        callback(results);
        connection.end(); // Close the connection after executing the query
      }
    );
  });
}

function insertDBTimestamp(message, callback) {
  const connection = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPassword,
    database: dbDatabase,
  });

  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to the database: " + err.stack);
      return;
    }

    let newRecord = {
      user: message.from,
      name: message._data.notifyName,
      timestamp: message.timestamp,
    };

    connection.query(
      "INSERT INTO auto_reply SET ?",
      newRecord,
      (err, results) => {
        if (err) {
          console.error("Error inserting record: " + err.stack);
          connection.end(); // Close the connection in case of an error
          return;
        }
        callback(results);
        connection.end(); // Close the connection after executing the query
      }
    );
  });
}
function addToBitrix(name, phone, email) {
  const bitrixCall =
    bitrixUrl +
    "/crm.lead.add.json?FIELDS[TITLE]=" +
    name +
    "&FIELDS[NAME]=" +
    name +
    "&FIELDS[EMAIL][0][VALUE]=" +
    email +
    "&FIELDS[PHONE][0][VALUE]=" +
    phone +
    "&FIELDS[SOURCE_ID]=" +
    bitrixSourceId;
  https
    .get(bitrixCall, (response) => {
      let data = "";

      response.on("data", (chunk) => {
        data += chunk;
      });

      response.on("end", () => {
        // Process the received data
      });
    })
    .on("error", (error) => {
      console.error("Error making the GET request:", error);
    });
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}
