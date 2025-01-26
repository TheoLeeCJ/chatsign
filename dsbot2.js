const fastify = require('fastify');
const fetch = require('node-fetch');
require('dotenv').config()
const mysql = require('mysql2/promise');
const fs = require("fs");
const short = require('short-uuid');
const { pipeline } = require('node:stream/promises');
const fastifyStatic = require('@fastify/static');
const path = require('path');
const jwt = require("jsonwebtoken");
const { Transform } = require('node:stream');

const fileHandler = require("./app_modules/fileHandler");
const messageGenerator = require("./app_modules/messageGenerator");
const docusignService = require('./app_modules/docusignService');
const globalMessageHandler = require('./app_modules/globalMessageHandler');
const aiChatbot = require("./app_modules/aiChatbot");

const BUSINESS_ACCOUNT_ID = process.env.BUSINESS_ACCOUNT_ID;
const PHONE_ID = process.env.PHONE_ID;
const FACEBOOK_TOKEN = fs.readFileSync(".fb_token").toString();

const dbConnection = mysql.createPool({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

const util = {};

util.base64Decode = (data) => {
  let buffer = Buffer.from(data, 'base64');
  return buffer.toString('utf-8');
}

util.base64Encode = (data) => {
  let buffer = Buffer.from(data);
  return buffer.toString('base64');
}

util.getUser = async (phone) => {
  const [rows, fields] = await dbConnection.execute(
    `SELECT * FROM user WHERE phone = ?`,
    [phone],
  );

  if (rows.length === 0) {
    return null;
  }
  else return rows[0];
}

util.setUserState = async (phone, state) => {
  await dbConnection.execute(`UPDATE user SET state = ? WHERE phone = ?`, [state, phone]);
};

async function sendMessage(data) {
  const sendReq = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
    method: "post",
    headers: {
      "Authorization": `Bearer ${FACEBOOK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }).then(res => res.text());
  console.log(sendReq);
}

async function run() {
  let app = fastify();
  // await dbConnection.execute("DELETE FROM user;");

  app.register(fastifyStatic, {
    root: path.join(__dirname, 'pages/templates'),
    prefix: '/templates/',
  });

  app.addContentTypeParser('*', (request, payload, done) => {
    let data = '';
    payload.on('data', chunk => {
      data += chunk;
    });
    payload.on('end', () => {
      done(null, data);
    });
  });

  // Webpages
  app.get("/docManage", (req, res) => res.type("text/html").send(fs.readFileSync(path.join(__dirname, 'pages', 'docManage.html'), 'utf-8')));
  app.get("/docPreview", (req, res) => res.type("text/html").send(fs.readFileSync(path.join(__dirname, 'pages', 'renderer.html'), 'utf-8')));
  app.get("/docReview/:docId", (req, res) => res.type("text/html").send(fs.readFileSync(path.join(__dirname, 'pages', 'docReview.html'), 'utf-8')));

  app.get('/docSetup', async (req, res) => {
    const fileId = req.query.fileId;
    if (!fileId) {
      res.statusCode = 400;
      return res.send('Missing fileId');
    }

    // Look up the doc record
    const [rows] = await dbConnection.execute(
      `SELECT * FROM document WHERE id = ?`,
      [fileId]
    );
    if (!rows || rows.length === 0) {
      res.statusCode = 404;
      return res.send('File not found in document');
    }
    const docRow = rows[0];

    // Render the HTML
    const html = await fileHandler.docSetupPageHtml(docRow);
    res.type("text/html").send(html);
  });
  // end webpages

  app.get('/obtainReviewPdf', async (req, res) => {
    const signerId = req.query.signerId;
    if (!signerId) {
      res.statusCode = 400;
      return res.send('Missing token');
    }

    try {
      const [rows, fields] = await dbConnection.execute(`SELECT docusignUser, docusignAccount, envelopeId FROM signer INNER JOIN document ON signer.document = document.id
        INNER JOIN user ON document.phone = user.phone WHERE signer.id = ?`, [signerId]);

      if (rows.length !== 1) throw Error("Invalid ID");
      const row = rows[0];

      const apiClient = await docusignService.getDocusignApiClient(row.docusignUser);

      const docUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${row.docusignAccount}/envelopes/${row.envelopeId}/documents/combined`;

      const documentRes = await fetch(docUrl, {
        method: 'GET',
        headers: {
          Authorization: apiClient.defaultHeaders.Authorization
        }
      });

      await pipeline(documentRes.body, res.raw);
    }
    catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.send();
    }
  });

  app.post('/docManage', async (req, res) => {
    const token = req.headers.authorization;
    const action = req.query.action;
    if (!token) {
      res.statusCode = 400;
      return res.send('Missing token');
    }

    const decoded = jwt.verify(token, process.env.INTERNAL_KEY, { algorithms: ['HS256'] });
    res.send({
      url: await docusignService.generateActionLink(dbConnection, decoded.phone, short().toUUID(decoded.id), action)
    });
  });

  app.get('/obtainReviewSignLink', async (request, reply) => {
    try {
      if (!request.query.signerId) return reply.send("Missing data");

      const [rows, fields] = await dbConnection.execute("SELECT signer.id, docusignUser, docusignAccount, envelopeId, routingOrder, signers FROM signer INNER JOIN document ON document.id = signer.document INNER JOIN user ON user.phone = document.phone WHERE signer.id = ?", [request.query.signerId]);
      if (rows.length !== 1) return reply.send("Invalid token");
      const row = rows[0];

      const apiClient = await docusignService.getDocusignApiClient(row.docusignUser);
      const docUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${row.docusignAccount}/envelopes/${row.envelopeId}/views/recipient`;

      const signers = JSON.parse(row.signers);

      console.log(signers[row.routingOrder - 1]);

      const documentRes = await fetch(docUrl, {
        method: 'POST',
        headers: {
          "Authorization": apiClient.defaultHeaders.Authorization,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientUserId: row.id,
          userName: signers[row.routingOrder - 1].name,
          email: signers[row.routingOrder - 1].email,
          returnUrl: "https://docusign.com",
          authenticationMethod: "SingleSignOn_Other",
        })
      }).then(res => res.json());
      console.log(documentRes);

      reply.send({
        url: documentRes.url,
      });
    }
    catch (e) {
      console.error(e);
      reply.send();
    }
  });

  app.get('/obtainReviewData', async (request, reply) => {
    try {
      if (!request.query.signerId) return reply.send("Missing data");

      const [rows, fields] = await dbConnection.execute("SELECT signer.id, originalFileName FROM signer INNER JOIN document ON document.id = signer.document WHERE signer.id = ?", [request.query.signerId]);
      if (rows.length !== 1) return reply.send("Invalid token");
      const row = rows[0];

      let storedMessages = [];
      if (fs.existsSync(`chatData/${row.id}-signer.json`)) storedMessages = JSON.parse(fs.readFileSync(`chatData/${row.id}-signer.json`).toString());

      reply.send({
        messages: storedMessages,
        filename: row.originalFileName,
        signLink: "...",
      });
    }
    catch (e) {
      console.error(e);
      reply.send();
    }
  });

  app.post('/obtainReviewAnswer', async (request, reply) => {
    if (!request.body.question || !request.body.signerId) return reply.send("Missing data");

    const [rows, fields] = await dbConnection.execute("SELECT fileText, signer.id FROM signer INNER JOIN document ON document.id = signer.document WHERE signer.id = ?", [request.body.signerId]);
    if (rows.length !== 1) return reply.send("Invalid token");
    const row = rows[0];

    const prompt = request.body.question.toString();

    let storedMessages = [];
    if (fs.existsSync(`chatData/${row.id}-signer.json`)) storedMessages = JSON.parse(fs.readFileSync(`chatData/${row.id}-signer.json`).toString());

    const captureStream = new Transform({
      transform(chunk, encoding, callback) {
        const chunkString = chunk.toString();
        this.push(chunk); // Pass the chunk through to the client

        // Parse the chunk as an SSE event
        const events = chunkString.split(/\r?\n\r?\n/);
        for (const event of events) {
          const lines = event.split(/\r?\n/);
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataContent = line.slice(6);
              try {
                const parsedData = JSON.parse(dataContent);
                if (parsedData.choices && parsedData.choices[0]?.delta?.content) {
                  this.responseBody += parsedData.choices[0].delta.content; // Append only the text content
                }
              } catch (error) {
                // Ignore parsing errors for non-JSON data
              }
            }
          }
        }

        callback();
      },
      flush(callback) {
        console.log("flushed llm stream");
        storedMessages.push({ role: 'user', content: prompt });
        storedMessages.push({ role: 'assistant', content: this.responseBody });
        fs.writeFileSync(`chatData/${row.id}-signer.json`, JSON.stringify(storedMessages, null, 2));
        callback();
      }
    });

    captureStream.responseBody = ''; // Initialize the response body

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-2024-07-18',
          stream: true,
          messages: [
            {
              role: 'system',
              content: `When the user asks you questions, quote the relevant part of the document and explain what it means and link it back to the user's question.
Your quotes should begin with <BEGIN_QUOTE_021> and end with <END_QUOTE_021>.
It's crucial that you keep your explanation and response CONCISE and EASILY UNDERSTANDABLE. Make it more spaced out instead of giant text chunks.
For actions or questions that are beyond what is specified in the document, direct them to discuss it with the sender.
For anything irrelevant to the document or topic, you should refuse to answer or direct the queries to the sender if applicable.

Quotes MUST be direct from the document, and you are free to split up if multiple quotes are used to answer a question.
You must quote just text removing symbols such as bullet points which may disrupt the process of finding the quote.
If the quote goes across pages just quote the first part.
DO NOT USE THE QUOTE SYMBOLS "" TO START AND END THE QUOTE

The document is as follows:

===BEGIN DOCUMENT===

${row.fileText}

===END DOCUMENT===`
            },
            ...storedMessages,
            { role: 'user', content: prompt }
          ],
          max_tokens: 1024,
          stream: true,
        }),
      }
    );

    // Pipe the response through the capture stream and then to the client
    await pipeline(response.body, captureStream, reply.raw);
  });

  app.post('/webhookCallback', async (request, reply) => {
    try {
      const { webhook } = request.query;
      if (!webhook) return reply.send("Missing webhook ID");

      const [docRows] = await dbConnection.execute(
        "SELECT document.id, envelopeId, originalFileName, user.phone, docusignUser, docusignAccount, signers, navigator FROM document INNER JOIN user ON document.phone = user.phone WHERE webhook = ?",
        [webhook]
      );

      console.log(JSON.stringify(request.body, null, 2));

      const body = request.body;
      if (docRows.length !== 1 || docRows[0].envelopeId !== body.envelopeId) return reply.send("Not found");
      const doc = docRows[0];
      const senderPhone = doc.phone;

      if (body.status === "sent") { // sent to a new recipient or completed
        const signers = body.recipients?.signers;

        let recipient, statusUpdate;

        if (!signers) return;
        for (let i = 0; i < signers.length; i++) {
          if (signers[i].status === "sent") {
            statusUpdate = "been sent";
            recipient = JSON.parse(doc.signers)[i];

            const [linkIdRows] = await dbConnection.execute("SELECT id FROM signer WHERE routingOrder = ? AND document = ?", [i + 1, doc.id]);
            if (linkIdRows.length < 1) return reply.send();
            const linkId = linkIdRows[0].id;

            // send notice to recipient
            sendMessage(messageGenerator.templateNotifyRecipient(recipient.phone, body?.sender?.userName, doc.originalFileName, doc.originalFileName, linkId));

            // send update to sender
            sendMessage(messageGenerator.templateUpdateSender(senderPhone, `${recipient.name} (${recipient.email})`, statusUpdate, doc.originalFileName));

            break;
          }
        }
      }
      else if (body.status === "completed") {
        if (doc.navigator === 1) {
          const sourceId = await aiChatbot.uploadToNavigator(doc); // not the safest way to get src id but it is otherwise difficult to link envelope text to navigator object
          console.log(sourceId);
          dbConnection.execute("UPDATE document SET srcId = ? WHERE envelopeId = ?", [sourceId, doc.envelopeId]);;
        }
        sendMessage(messageGenerator.templateUpdateSender(senderPhone, `Every recipient`, "signed", doc.originalFileName));
      }

      reply.code(200).send();
    }
    catch (e) {
      console.error(e);
      res.send();
    }
  });

  app.get('/obtainManageData', async (req, res) => {
    try {
      const token = req.headers.authorization;
      if (!token) {
        res.statusCode = 400;
        return res.send('Missing token');
      }

      const decoded = jwt.verify(token, process.env.INTERNAL_KEY, { algorithms: ['HS256'] });

      res.send(await docusignService.obtainManageData(dbConnection, decoded.phone, short().toUUID(decoded.id)));
    }
    catch (e) {
      console.error(e);
    }
  });

  app.get('/obtainPreviewData', async (req, res) => {
    const fileId = req.query.fileId;
    if (!fileId) {
      res.statusCode = 400;
      return res.send('Missing fileId');
    }

    res.send(await docusignService.obtainPreviewData(dbConnection, fileId));
  });

  // send (created -> sent)
  app.get(`/docSend`, async (req, res) => {
    const { fileId } = req.query;
    if (!fileId) {
      res.statusCode = 400;
      return res.send('Missing fileId');
    }

    const [docRows] = await dbConnection.execute(
      'SELECT * FROM document WHERE id = ?',
      [fileId]
    );

    if (!docRows || docRows.length === 0) {
      throw new Error(`No document record found for fileId: ${fileId}`);
    }

    const docRow = docRows[0];
    const { envelopeId } = docRow;
    if (!envelopeId) {
      throw new Error(`document record with id ${fileId} has no envelopeId`);
    }

    const user = await util.getUser(docRow.phone);
    console.log(user);

    res.send(await docusignService.sendDraftEnvelope(dbConnection, fileId, docRow, user));
  });

  app.post('/docSetup', async (req, res) => {
    try {
      const { fileId, recipients, navigator } = req.body;
      if (!fileId || !recipients || !navigator) {
        res.statusCode = 400;
        return res.send('Missing fileId or recipients');
      }

      const recipientsArray = recipients;
      // Retrieve the phone number associated with the fileId
      const [docRows] = await dbConnection.execute(
        'SELECT phone, originalFileName FROM document WHERE id = ?',
        [fileId]
      );

      if (!docRows || docRows.length === 0) {
        res.statusCode = 404;
        return res.send('File not found in document');
      }

      const phone = docRows[0].phone;

      // Create the draft envelope using the newly added method
      const webhookId = short.generate();
      await dbConnection.execute("UPDATE document SET webhook = ?, navigator = ? WHERE id = ?", [webhookId, navigator == true ? 1 : 0, fileId]);
      const envelopeId = await docusignService.createDraftEnvelope(
        dbConnection,
        phone,
        fileId,
        recipientsArray,
        `https://app.chatsign.net/webhookCallback?webhook=${webhookId}` // mitigate spoofing
      );

      // Notify the user via WhatsApp
      await sendMessage({
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {
          "body": `Draft envelope created successfully. You can review and send it at https://app.chatsign.net/docPreview#${fileId}.`
        }
      });

      await util.setUserState(phone, `awaitDraftApproval.${docRows[0].originalFileName}`);
      console.log(await util.getUser(phone));

      res.send({ fileId });
    } catch (error) {
      console.error('Error in /docSetup POST route:', error);
      res.statusCode = 500;
      res.send('Error creating draft envelope');
    }
  });

  // Docusign Auth Call back
  app.get('/callback', async (req, res) => {
    const { state, code } = req.query;

    if (!state || !code) {
      res.statusCode = 400;
      return res.send({ error: 'Missing data in query params' });
    }

    try {
      const result = await docusignService.callbackDocusign(dbConnection, state, code);

      sendMessage(messageGenerator.linked(result.phone));

      res.type("text/html").send(fs.readFileSync("pages/accountLinked.html"));
    } catch (error) {
      console.error('Error in /callback route for docusign auth:', error);
      res.statusCode = 500;
      res.send({ error: 'Error during linking DocuSign user' });
    }
  });

  // initial setup
  app.get(`/recvWaMsg`, (req, res) => {
    if (req.query["hub.challenge"]) {
      res.statusCode = 200;
      res.send(req.query["hub.challenge"]);
    }
    else {
      res.statusCode = 400;
      res.send();
    }
  });

  // recv msg
  app.post(`/recvWaMsg`, async (req, res) => {
    // console.log(JSON.stringify(req.body, null, 2));

    // send response early to prevent Facebook from thinking we timed out
    res.statusCode = 200;
    res.send();

    console.log(JSON.stringify(req.body, null, 2));

    try {
      for (const entry of req.body.entry) {
        console.log(entry.id);
        if (entry.id !== BUSINESS_ACCOUNT_ID) break;
        for (const change of entry.changes) {
          console.log(change.value.messaging_product);
          if (change.value.messaging_product !== "whatsapp") continue;
          if (!change.value.contacts) continue;

          await globalMessageHandler(dbConnection, util, sendMessage, change, FACEBOOK_TOKEN);
        }
      }
    }
    catch (e) {
      console.log(JSON.stringify(req.body, null, 2))
      console.error(e);
    }
  });

  // strip all request validation errors
  app.addHook('onSend', async (req, res, payload) => {
    const contentType = res.getHeader('Content-Type') || res.getHeader('content-type');
    if (contentType?.includes('application/json')) {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
        if (data.statusCode >= 400) {
          delete data.error;
          delete data.message;
          return JSON.stringify(data);
        }
      } catch { }
    }
    return payload;
  });

  // ...
  app.listen({ port: 8090 });

  // gracle shutdown + Windows workaround
  if (process.platform === "win32") {
    let rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on("SIGINT", function () {
      process.emit("SIGINT");
    });
  }

  process.on("SIGINT", function () {
    // graceful shutdown
    dbConnection.end();
    console.log("Closed MySQL connection.");
    process.exit();
  });
}

run();
