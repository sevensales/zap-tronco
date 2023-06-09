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
  messages = data.split("---");
});

function randomMessage() {
  return messages[Math.floor(Math.random() * messages.length)].trim();
}

const appAutoReply = JSON.parse(process.env.APP_AUTO_REPLY.toLowerCase());
const appAPIChats = JSON.parse(process.env.APP_API_CHATS.toLowerCase());
const appAPIMessage = JSON.parse(process.env.APP_API_MESSAGE.toLowerCase());
const appAPIport = process.env.API_PORT;
const messageDelay = parseInt(process.env.MESSAGE_DELAY);
const dbHost = process.env.DB_HOST;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbDatabase = process.env.DB_DATABASE;
const replyInterval = parseInt(process.env.REPLY_INTERVAL);
const bitrixUrl = process.env.BITRIX_URL;
const bitrixSourceId = process.env.BITRIX_SOURCE_ID;

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const processedMessages = {};
var zapReady = false;
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox"],
  },
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  zapReady = true;
  console.log("web-whatsapp is ready.");
});

if (appAutoReply) {
  client.on("message", (message) => {
    const messageId = message.from;

    // Check if the message ID has already been processed
    if (processedMessages.hasOwnProperty(messageId)) {
      const storedTimestamp = processedMessages[messageId].timestamp;
      const currentTimestamp = unixTimestamp();
      const timeDifference = currentTimestamp - storedTimestamp;

      // Check if the reply interval has passed since the last processed message
      if (timeDifference < replyInterval) {
        // Don't process the message yet
        return;
      }
    }

    message.getChat().then(function (chat) {
      if (!chat.isGroup) {
        checkDBTimestamp(message, function (results) {
          if (results && results.length > 0) {
            if (results[0].timestamp + replyInterval < unixTimestamp()) {
              updateDBTimestamp(message, function (results) {
                message.reply(randomMessage());
                addToBitrix(
                  message._data.notifyName === undefined
                    ? message.from.replace("@c.us", "")
                    : message._data.notifyName,
                  message.from.replace("@c.us", ""),
                  ""
                );
              });
            } else {
              // Don't send any response
            }
          } else {
            insertDBTimestamp(message, function (results) {
              message.reply(randomMessage());
              addToBitrix(
                message._data.notifyName === undefined
                  ? message.from.replace("@c.us", "")
                  : message._data.notifyName,
                message.from.replace("@c.us", ""),
                ""
              );
            });
          }

          // Store the message ID and timestamp in processedMessages object
          processedMessages[messageId] = {
            timestamp: message.timestamp,
          };
        });
      }
    });
  });
  console.log("ZAP: Auto reply is ON");
} else {
  console.log("ZAP: Auto reply is OFF");
}

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

if (appAPIMessage) {
  // Endpoint for message/file upload
  app.post("/message", upload.single("file"), (req, res) => {
    const number = req.query.number;
    const message = req.query.message;
    const fileUrl = req.query.fileUrl;

    if (number && (fileUrl || message)) {
      const numberWithSuffix = number.includes("@c.us")
        ? number
        : `${number}@c.us`;

      if (fileUrl) {
        MessageMedia.fromUrl(fileUrl)
          .then((media) => {
            client.sendMessage(numberWithSuffix, media);
          })
          .catch((error) => {
            console.error("Error retrieving file from URL:", error);
          });
      }

      if (message) {
        client.sendMessage(numberWithSuffix, message);
      }
    }

    res.send("Message received.");
  });

  app.get("/message", (req, res) => {
    const number = req.query.number;
    const message = req.query.message;
    const fileUrl = req.query.fileUrl;

    if (number && (fileUrl || message)) {
      const numberWithSuffix = number.includes("@c.us")
        ? number
        : `${number}@c.us`;

      if (fileUrl) {
        MessageMedia.fromUrl(fileUrl)
          .then((media) => {
            client.sendMessage(numberWithSuffix, media);
          })
          .catch((error) => {
            console.error("Error retrieving file from URL:", error);
          });
      }

      if (message) {
        client.sendMessage(numberWithSuffix, message);
      }
    }

    res.send("Message received.");
  });
  console.log("API: POST /message endpoint is ON");
} else {
  console.log("API: POST /message endpoint is OFF");
}

if (appAPIChats) {
  // Endpoint for fetching chats
  app.get("/chats", (req, res) => {
    if (zapReady) {
      client.getChats().then((chats) => {
        res.json(chats);
      });
    } else {
      res.send("Web Whatsapp not ready, wait until it's fully loaded.");
    }
  });
  console.log("API: GET /chats endpoint is ON");
} else {
  console.log("API: GET /chats endpoint is OFF");
}

// Start the server

app.listen(appAPIport, () => {
  console.log(`API is running on port ${appAPIport}`);
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

function updateDBTimestamp(message, callback) {
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
      name:
        message._data.notifyName === undefined
          ? message.from.replace("@c.us", "")
          : message._data.notifyName,
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
      name:
        message._data.notifyName === undefined
          ? message.from.replace("@c.us", "")
          : message._data.notifyName,
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
