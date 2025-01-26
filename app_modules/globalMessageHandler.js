const fetch = require('node-fetch');
const fs = require("fs");
const short = require('short-uuid');

const fileHandler = require("./fileHandler");
const messageGenerator = require("./messageGenerator");
const docusignService = require('./docusignService');
const aiChatbot = require("./aiChatbot");

async function globalMessageHandler(dbConnection, util, sendMessage, change, FACEBOOK_TOKEN) {
  const messageData = {};
  messageData.customerName = change.value.contacts[0].profile.name;
  messageData.customerID = change.value.contacts[0].wa_id;

  for (const message of change.value.messages) {
    console.log(message.from);
    if (messageData.customerID !== message.from) continue;
    messageData.type = message.type;

    console.log(messageData);
    const phone = messageData.customerID;

    const user = await util.getUser(messageData.customerID);
    if (!user) {
      await sendMessage(messageGenerator.onboarding1(messageData.customerID));
      sendMessage(messageGenerator.onboarding2(messageData.customerID, await docusignService.getDocuSignLink(dbConnection, messageData.customerID)));
      return;
    }
    else {
      console.log(user);
      if (message.type === "interactive") {
        const interactiveId = message.interactive[message.interactive.type].id;
        switch (interactiveId) {
          case "listFunctions":
            await sendMessage(messageGenerator.listFunctions(phone));
            break;
          case "newAgreement":
            await sendMessage(messageGenerator.newAgreementBegin1(phone));
            await sendMessage(messageGenerator.newAgreementBegin2(phone));
            await util.setUserState(phone, "newAgreementAcceptDocument");
            break;
          case "cancelDocument":
            await sendMessage(messageGenerator.genericCancelled(phone));
            await util.setUserState(phone, "idle");
            break;
          case "template_employmentOffer":
            await sendMessage(messageGenerator.templateDownload(phone, "Employment Offer", "https://app.chatsign.net/templates/Docusign_Template-Employment_Offer_Letter.docx"));
            break;
          case "template_emergencyContact":
            await sendMessage(messageGenerator.templateDownload(phone, "Emergency Contact & Medical Release Waiver", "https://app.chatsign.net/templates/Docusign_Template-Emergency_Contact_and_Medical_Waiver.docx"));
            break;
          case "template_salesContract":
            await sendMessage(messageGenerator.templateDownload(phone, "Sales Contract", "https://app.chatsign.net/templates/Docusign_Template-Sales_Contract.docx"));
            break;
          case "template_statementOfWork":
            await sendMessage(messageGenerator.templateDownload(phone, "Statement of Work", "https://app.chatsign.net/templates/Docusign_Template_Library-SOW.pdf"));
            break;
          case "manageAgreements":
            await util.setUserState(phone, "manageAgreementsHome");
            
            const recentEnvelopes = await docusignService.getEnvelopes(dbConnection, phone);
            await sendMessage(messageGenerator.agreementsList(phone, recentEnvelopes));
            break;
          default:
            if (interactiveId.startsWith("manageAgreement.")) {
              const docId = interactiveId.replace("manageAgreement.", "");
              if (docId === "CONSOLE") {
                const link = await docusignService.generateActionLink(dbConnection, phone, "", "allOptions");
                await sendMessage({
                  "messaging_product": "whatsapp",
                  "recipient_type": "individual",
                  "to": phone,
                  "type": "interactive",
                  "interactive": {
                    "type": "button",
                    "body": {
                      "text": `Manage your older envelopes in the Docusign Console using this link: ${link}\n\nFor your security, it expires once you have used it. You can obtain a new link below:`
                    },
                    "action": {
                      "buttons": [
                        {
                          "type": "reply",
                          "reply": {
                            "id": `manageAgreement.CONSOLE`,
                            "title": "Get new link"
                          }
                        },
                      ]
                    },
                  }
                });
                return;
              }
              await sendMessage(await docusignService.generateEnvelopeDetailMessage(dbConnection, phone, docId));
            }
        }
      }
      else if (message.type === "document") {
        if (user.state !== "newAgreementAcceptDocument") {
          sendMessage(messageGenerator.unexpectedDocumentHandling(phone));
        }
        if (user.state.startsWith("awaitDraftApproval.") || user.state.startsWith("awaitDraftConfiguration.")) {
          sendMessage(messageGenerator.cancelliingPreviousDocument(phone, user.state.slice(user.state.indexOf(".") + 1)));
        }

        const filename = message.document.filename;
        const splitFilename = filename.split(".");
        const fileExt = splitFilename[splitFilename.length - 1];
        const mediaResponse = await fetch(`https://graph.facebook.com/v21.0/${message.document.id}`, {
          headers: {
            "Authorization": `Bearer ${FACEBOOK_TOKEN}`,
          },
        }).then(res => res.json());
        console.log(mediaResponse);
        const media = await fetch(mediaResponse.url, {
          headers: {
            "Authorization": `Bearer ${FACEBOOK_TOKEN}`,
          },
        }).then(res => res.blob());

        const mediaBuffer = Buffer.from(new Uint8Array(await media.arrayBuffer()));

        const extractedText = await fileHandler.extractText(mediaBuffer, fileExt);
        console.log(await fileHandler.extractText(mediaBuffer, fileExt));

        const parsedFields = await fileHandler.parseFieldMarkers(extractedText);
        console.log(parsedFields);

        // If no placeholders found, notify user
        if (parsedFields.maxRecipientIndex === 0) {
          await sendMessage({
            "messaging_product": "whatsapp",
            "to": phone,
            "type": "text",
            "text": {
              "body": `We did not detect any placeholders like [SIGNATURE #], [DATE #], or [TEXT #A] in your document "${filename}". Please check formatting.`
            }
          });
          return;
        }

        // Save to local tmp folder
        const fileId = short.generate();
        const tmpFolder = './userFiles';
        if (!fs.existsSync(tmpFolder)) {
          fs.mkdirSync(tmpFolder);
        }
        const tmpFilePath = `${fileId}.${fileExt}`;
        fs.writeFileSync("./userFiles/" + tmpFilePath, mediaBuffer);

        // Insert record in document
        await dbConnection.execute(
          `INSERT INTO document (id, phone, fieldsJson, fileName, state, createdAt, originalFileName)
          VALUES(?, ?, ?, ?, ?, NOW(), ?)`,
          [
            fileId,
            phone,
            JSON.stringify(parsedFields),
            tmpFilePath,
            'pendingSetup',
            filename,
          ]
        );

        // Notify user of how many recipients placeholders were found for
        await sendMessage({
          "messaging_product": "whatsapp",
          "to": phone,
          "type": "text",
          "text": {
            "body": `We found placeholders supporting up to ${parsedFields.maxRecipientIndex} recipient(s) in "${filename}". 
Please fill in recipient details here:
https://app.chatsign.net/docSetup?fileId=${fileId}`
          }
        });

        await util.setUserState(phone, `awaitDraftConfiguration.${filename}`)
      }
      else if (message.type === "text") {
        if (message.text) {
          if (["hi", "hi!", "hi.", "hello", "hello!", "hello."].includes(message.text.body.toLowerCase())) sendMessage(messageGenerator.hi(phone));
          else {
            // store convo history in file
            await aiChatbot.handleNaturalLanguage(dbConnection, phone, messageData.customerName, message.text.body, sendMessage);
          }
        }
      }
      // console.log(await docusignService.getEnvelope(dbConnection, messageData.customerID));
    }
  }
}

module.exports = globalMessageHandler;