const short = require("short-uuid");

const messages = {};

messages.agreementsList = (to, envelopes) => {
  const sections = [{ "title": "Recent", "rows": [] }, { "title": "Older envelopes", "rows": [] }];

  for (let i = 0; i < (envelopes.length > 9 ? 9 : envelopes.length); i++) {
    let docName = envelopes[i]?.envelopeDocuments?.filter(el => el.order === '1')[0]?.name;
    if (docName.length > 22) docName = docName.slice(0, 21) + '…';

    const fmtDate = (new Date(envelopes[i]?.statusChangedDateTime)).toISOString().slice(0, 10);

    const signers = envelopes[i].recipients?.signers?.map(el => {
      // Cap the name to 18 characters and append ellipsis if necessary
      const maxLength = 18;
      const name = el.name.length > maxLength ? el.name.substring(0, maxLength) + '…' : el.name;
      return name;
    });

    // Create the natural sentence
    let signersSentence;
    if (signers.length <= 2) {
      // If there are 2 or fewer signers, list them all
      signersSentence = signers.join(', ');
    } else {
      // If there are more than 2 signers, list the first two and add the count of remaining signers
      const firstTwoSigners = signers.slice(0, 2).join(', \n');
      const remainingCount = signers.length - 2;
      signersSentence = `${firstTwoSigners}, (… ${remainingCount} others)`;
    }

    sections[0].rows.push({
      id: `manageAgreement.${envelopes[i]?.envelopeId}`,
      title: `📄 ${docName}`,
      description: `${envelopes[i]?.status} ${fmtDate} • ${signersSentence}`,
    });
    
    console.log(envelopes[i].recipients.signers);
  }

  if (sections[0].rows.length === 0) {
    sections[0].rows.push({
      id: `manageAgreement.NONE`,
      title: "No recent envelopes",
      description: "You do not have any recent envelopes containing agreements.",
    });
  }

  sections[1].rows.push({
    id: `manageAgreement.CONSOLE`,
    title: "(View older envelopes)",
    description: "View older envelopes on Docusign",
  });

  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "list",
      "body": {
        "text": `*_Manage envelopes_*
        
Your most recent agreements in envelopes are shown below. Select an agreement to sign, void, view, correct or perform other actions on from the list below.`
      },
      "action": {
        "button": "Recent envelopes",
        sections,
      }
    }
  };
};

messages.templateUpdateSender = (to, recipientNameEmail, action, filename) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "template",
    "template": {
      "name": "recipient_received",
      "components": [
        {
          "type": "body",
          "parameters": [
            {
              "type": "text",
              "text": recipientNameEmail
            },
            {
              "type": "text",
              "text": action
            },
            {
              "type": "text",
              "text": filename
            }
          ]
        }
      ],
      "language": {
        "code": "en"
      }
    }
  }
};

messages.templateNotifyRecipient = (to, senderName, documentName, description, linkId) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "template",
    "template": {
      "name": "agreement_sent",
      "components": [
        {
          "type": "body",
          "parameters": [
            {
              "type": "text",
              "text": senderName
            },
            {
              "type": "text",
              "text": documentName
            },
            {
              "type": "text",
              "text": description
            }
          ]
        },
        {
          "type": "button",
          "sub_type": "url",
          "index": 0,
          "parameters": [
            {
              "type": "text",
              "text": linkId
            }
          ]
        }
      ],
      "language": {
        "code": "en"
      }
    }
  }
};

messages.unexpectedDocumentHandling = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {
        "text": `_*Processing document*_

I'll try to process this document as an agreement to be uploaded.`
      },
      "action": {
        "buttons": [
          {
            "type": "reply",
            "reply": {
              "id": `cancelDocument`,
              "title": "Cancel"
            }
          },
        ]
      },
    }
  };
};

messages.genericCancelled = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": {
      "preview_url": true,
      "body": `Cancelled. Is there anything else I can help you with?`
    }
  };
};

messages.cancelliingPreviousDocument = (to, fileName) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": {
      "preview_url": true,
      "body": `I'm cancelling your unconfirmed document '${fileName}'.`
    }
  };
};

messages.newAgreementBegin1 = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {
        "text": `_*Create new agreement*_

An envelope contains an agreement which can be sent to recipients in a specified order. You can create signature and text fields for recipients to fill in.

_*Field formatting*_

You can place [SIGNATURE 1], [SIGNATURE 2], ... in text anywhere on the agreement to auto-create signature fields which recipients can sign.

[DATE 1], [DATE 2], ... will be auto-filled with the date on which a recipient signed the agreement.

[TEXT 1A], [TEXT 1B], ... can form custom text boxes which you want recipients to fill in.
1A and 1B will be filled in by the first recipient, and 2A, 2B can be filled in by subsequent recipients, etc.

To hide the formatting labels, you can match the text color to the background.`
      },
      "action": {
        "buttons": [
          {
            "type": "reply",
            "reply": {
              "id": `cancelDocument`,
              "title": "Cancel"
            }
          },
        ]
      },
    }
  };
};

messages.templateDownload = (to, templateName, downloadLink) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": {
      "preview_url": true,
      "body": `_*Download template - ${templateName}*_
      
Here is the link to download the "${templateName}" template provided by Docusign to help you easily and quickly draft your agreement.

${downloadLink}`
    }
  };
};

messages.newAgreementBegin2 = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "list",
      "body": {
        "text": `*_Common templates_*
        
Docusign offers a range of templates for common agreements.
        
If you like, you can download templates for common agreement types by using the button below.

*When you're ready, you may upload a PDF, Word, plain text or RTF file for me to prepare as a Docusign envelope for you.*`
      },
      "action": {
        "button": "View templates",
        "sections": [
          {
            "title": "Common templates",
            "rows": [
              {
                "id": "template_salesContract",
                "title": "Sales Contract",
                "description": "Speed up sales contract approval with Docusign"
              },
              {
                "id": "template_statementOfWork",
                "title": "Statement of Work",
                "description": "Used for defining and agreeing upon project scope and terms of service"
              },
              {
                "id": "template_employmentOffer",
                "title": "Employment Offer Letter",
                "description": "Employment offer letter for onboarding new candidates"
              },
              {
                "id": "template_emergencyContact",
                "title": "Emergency Contact...",
                "description": "Emergency contact & medical release waiver for schools, teams and clubs"
              }
            ]
          }
        ]
      }
    }
  };
};

messages.aiChatbotProcessing = (to, linkUrl) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": { // the text object
      "preview_url": true,
      "body": `Give me a second to browse your Docusign Navigator repository...`
    }
  };
};

messages.listFunctions = (to, linkUrl) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": { // the text object
      "preview_url": true,
      "body": `I am still being actively developed, but here is what I can do for you:

- *Answer Questions about Agreements* which you have uploaded to Docusign Navigator - just text me with your question and I'll find the answer in your agreements
- (full information extraction is only available for agreements uploaded to Navigator via Docusign Assistant)
- *Powered by Docusign Navigator*
      
- *Create Envelopes* from PDF and Word (DOCX) files
- specify recipients and review agreement before sending
- alert you when recipients have been sent the agreements

- *Send Word and PDF Templates* from Docusign to base your agreements on

- *List and help you manage* specific agreements (void, edit, etc)`
    }
  };
};

messages.onboarding1 = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": { // the text object
      "preview_url": true,
      "body": `Hi! I'm your Docusign Assistant, here to help you manage agreements faster and smarter using Docusign.

It seems that you haven't linked your Docusign account yet. You need to link your Docusign Account for me to help you manage agreements.`
    }
  };
};

messages.onboarding2 = (to, linkUrl) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "text",
    "text": { // the text object
      "preview_url": true,
      "body": `Please use the link below to link it, or sign up for one.

*Link Docusign Account:*

${linkUrl}`
    }
  };
};

const stock3Entrypoints = {
  "buttons": [
    {
      "type": "reply",
      "reply": {
        "id": `listFunctions`,
        "title": "What can you do?"
      }
    },
    {
      "type": "reply",
      "reply": {
        "id": `newAgreement`,
        "title": "Create new agreement"
      }
    },
    {
      "type": "reply",
      "reply": {
        "id": `manageAgreements`,
        "title": "Manage my agreements"
      }
    }
  ]
};

messages.linked = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {
        "text": `*Account Linked & Ready*
Thank you for linking your Docusign Account. I can now help you manage your documents on Docusign. How may I help you today?

ℹ *TIP*: You can also ask me questions about the agreements in your account which have been indexed by Docusign Navigator (full information only available for agreements sent via ChatSign).`
      },
      "action": stock3Entrypoints,
    }
  };
};

messages.hi = (to) => {
  return {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": to,
    "type": "interactive",
    "interactive": {
      "type": "button",
      "body": {
        "text": `Welcome back! I'm your Docusign Assistant, here to help you manage agreements faster and smarter. How may I help?

ℹ *TIP*: You can also ask me questions about the agreements in your account which have been indexed by Docusign Navigator (full information only available for agreements sent via ChatSign).`
      },
      "action": stock3Entrypoints,
    }
  };
};

module.exports = messages;