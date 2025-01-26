const docusign = require('docusign-esign');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const short = require('short-uuid');
require('dotenv').config();

const fileHandler = require("./fileHandler");

const privateKeyPath = path.join(__dirname, '../privkey.pem');
const integratorKey = process.env.DOCUSIGN_INTEGRATION_KEY;
const clientSecret = process.env.DOCUSIGN_CLIENT_SECRET;
const authServer = 'account-d.docusign.com';
const redirectUri = 'https://dsbot2.theoleecj.net/callback';

const docusignService = {};

function obtainApiClient() {
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(authServer);
  apiClient.hasNoInvalidScopes = (checkScopes) => { // PATCH REQUIRED TO OBTAIN NAVIGATOR API SCOPES
    for (const scp of checkScopes) {
      if (!['signature', 'impersonation', 'adm_store_unified_repo_read', 'adm_store_unified_repo_write', 'search_read', 'document_uploader_write', 'document_uploader_read', 'extended'].includes(scp)) return false;
    }
    return true;
  };
  return apiClient;
}

async function getDocusignApiClient(docusignUser) {
  const apiClient = obtainApiClient();
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  const scopes = ['signature', 'impersonation', 'adm_store_unified_repo_read', 'adm_store_unified_repo_write', 'search_read', 'document_uploader_write', 'document_uploader_read'];
  const jwtResponse = await apiClient.requestJWTUserToken(
    integratorKey,
    docusignUser,
    scopes,
    privateKey,
    3600
  );

  const accessToken = jwtResponse.body.access_token;
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  apiClient.setBasePath("https://demo.docusign.net/restapi");
  return apiClient;
}

docusignService.getDocusignApiClient = getDocusignApiClient;

docusignService.getDocuSignLink = async (dbConnection, phone) => {
  const apiClient = obtainApiClient();

  const scopes = ['signature', 'impersonation', 'adm_store_unified_repo_read', 'adm_store_unified_repo_write', 'search_read', 'document_uploader_write', 'document_uploader_read'];

  // Generate JWT token for phone
  const token = jwt.sign({ phone }, process.env.INTERNAL_KEY, { algorithm: 'HS256', expiresIn: '1h' });

  const authorizationUri = apiClient.getAuthorizationUri(
    integratorKey,
    scopes,
    `${redirectUri}`,
    'code',
    token
  );

  return authorizationUri;
};

docusignService.callbackDocusign = async (dbConnection, token, authorizationCode) => {
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.INTERNAL_KEY, { algorithms: ['HS256'] });
    const phone = decoded.phone;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(`https://${authServer}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${integratorKey}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        state: token,
        redirect_uri: `${redirectUri}`,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`Error fetching token: ${tokenData.error_description || 'Unknown error'}`);
    }

    const accessToken = tokenData.access_token;

    const apiClient = new docusign.ApiClient();
    apiClient.setOAuthBasePath(authServer);
    const userInfo = await apiClient.getUserInfo(accessToken);

    const account = userInfo.accounts[0];
    const userId = userInfo.sub;

    await dbConnection.execute(
      'INSERT INTO user (phone, docusignUser, docusignAccount, state) VALUES(?, ?, ?, "created")',
      [phone, userId, account.accountId]
    );

    return { message: 'User linked successfully', phone };
  } catch (err) {
    console.error(`DocuSign callback error: ${err.message}`);
    throw err;
  }
};

docusignService.getEnvelopes = async (dbConnection, phone) => {
  const [rows] = await dbConnection.execute(
    'SELECT * FROM user WHERE phone = ?',
    [phone]
  );
  if (!rows || rows.length === 0) {
    throw new Error(`No user found for phone: ${phone}`);
  }

  const user = rows[0];
  if (!user.docusignUser || !user.docusignAccount) {
    throw new Error(`User with phone ${phone} has not linked a DocuSign account`);
  }

  const apiClient = await getDocusignApiClient(user.docusignUser);
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const fromDate = new Date("2020-01-01");
  const options = { fromDate: fromDate.toISOString(), count: 20, orderBy: "last_modified", order: "desc", include: ["recipients", "documents"] };

  const envelopesResponse = await envelopesApi.listStatusChanges(user.docusignAccount, options);
  const envelopes = envelopesResponse?.envelopes || [];

  return envelopes;
};

docusignService.sendDraftEnvelope = async (dbConnection, fileId, docRow, user) => {
  try {
    const { docusignAccount, docusignUser } = user;

    if (!docusignAccount || !docusignUser) {
      throw new Error(`User is missing docusignAccount or docusignUser`);
    }

    const envelopeId = docRow.envelopeId;

    const apiClient = await getDocusignApiClient(docusignUser);
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const pageUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${docusignAccount}/envelopes/${envelopeId}`;

    const sendResponse = await fetch(pageUrl, {
      method: 'PUT',
      headers: {
        Authorization: apiClient.defaultHeaders.Authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "status": "sent"
      })
    }).then(res => res.json());

    const splitFilename = docRow.fileName.split(".");
    const fileExt = splitFilename[splitFilename.length - 1];

    const docUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${docusignAccount}/envelopes/${envelopeId}/documents/combined`;

    const documentRes = await fetch(docUrl, {
      method: 'GET',
      headers: {
        Authorization: apiClient.defaultHeaders.Authorization
      }
    }).then(res => res.buffer());

    const extractedText = await fileHandler.extractText(documentRes, "pdf");

    await dbConnection.execute(
      `UPDATE document SET state = ?, fileText = ? WHERE id = ?`,
      ['sent', extractedText, fileId]
    );

    await dbConnection.execute(
      `UPDATE user SET state = ? WHERE phone = ?`,
      ['idle', user.phone]
    )

    console.log(`Envelope ${envelopeId} sent successfully.`);
    console.log(sendResponse);
    return sendResponse;
  } catch (error) {
    console.error('Error in sendDraftEnvelope:', error);
    throw error;
  }
};

function formatDate(isoString) {
  const date = new Date(isoString);
  const options = {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  };
  return date.toLocaleString('en-US', options);
}

docusignService.generateEnvelopeDetailMessage = async (dbConnection, phone, docId) => {
  try {
    const [userRows] = await dbConnection.execute(
      'SELECT * FROM user WHERE phone = ?',
      [phone]
    );
    if (userRows.length !== 1) throw Error("No user found");
    const user = userRows[0];

    const apiClient = await getDocusignApiClient(user.docusignUser);
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const envelopeDetails = await envelopesApi.getEnvelope(user.docusignAccount, docId, { include: ["recipients", "documents"] });
    const output = formatEnvelopeStatus(envelopeDetails);
    const documentName = envelopeDetails.envelopeDocuments?.find(doc => doc.order === '1')?.name || 'Document';

    const manageToken = jwt.sign({ phone, id: short().fromUUID(docId) }, process.env.INTERNAL_KEY, { algorithm: 'HS256', expiresIn: '3h' });
    const dsbotLink = `https://dsbot2.theoleecj.net/docManage#${manageToken}`

    return {
      "messaging_product": "whatsapp",
      "recipient_type": "individual",
      "to": phone,
      "type": "interactive",
      "interactive": {
        "type": "button",
        "body": {
          "text": `_*${documentName}*_\n\n
${output}

*🔗 Manage, view, void or update your agreement using this link:*
${dsbotLink}

Do not share the link to third parties who you would not trust with your Docusign account.
For your security, it expires in 3 hours. *You can select "Get new link" to get a new one when this one expires.*`
        },
        "action": {
          "buttons": [
            {
              "type": "reply",
              "reply": {
                "id": `manageAgreement.${docId}`,
                "title": "Get new link"
              }
            },
          ]
        },
      }
    };
  }
  catch (e) {
    console.error(e);
    throw e;
  }
};

function formatEnvelopeStatus(envelopeDetails) {
  // Helper function to format ISO date strings to "MM/DD/YYYY hh:mmam/pm"
  function formatDate(isoString) {
    const date = new Date(isoString);
    const options = {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    };
    return date.toLocaleString('en-US', options);
  }

  const signers = envelopeDetails.recipients.signers;

  const signed = signers.filter(signer => signer.status === 'completed');
  const sentSigners = signers.filter(signer => signer.status === 'delivered');
  const pending = signers.filter(signer => signer.status === 'created');

  let output = '';

  // Handle sent signers
  if (sentSigners.length > 0) {
    const signer = sentSigners[0];
    output += `⏰ Waiting for ${signer.name}\n`;
    const sentDate = formatDate(envelopeDetails.sentDateTime);
    output += `Email sent to ${signer.email} at ${sentDate}\n\n`;
  }

  // Handle signed signers
  if (signed.length > 0) {
    output += `✅ Signed:\n`;
    signed.forEach(signer => {
      const completedDate = signer.completedDateTime ? formatDate(signer.completedDateTime) : '';
      output += `${signer.name}${completedDate ? ` (${completedDate})` : ''}\n`;
    });
    output += `\n`;
  }

  // Handle pending signers
  if (pending.length > 0) {
    const pendingNames = pending.map(signer => signer.name).join(', ');
    output += `⏳ Pending:\n${pendingNames}\n`;
  }

  return output;
}

// Helper function to generate a link based on action type
docusignService.generateActionLink = async (dbConnection, phone, envelopeId, actionType) => {
  // Fetch user details from the database
  const [userRows] = await dbConnection.execute(
    'SELECT * FROM user WHERE phone = ?',
    [phone]
  );
  if (userRows.length !== 1) throw Error("No user found");
  const user = userRows[0];

  // Initialize DocuSign API client
  const apiClient = await getDocusignApiClient(user.docusignUser);
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  console.log(dbConnection, phone, envelopeId, actionType, user);

  let view;

  switch (actionType) {
    case 'viewEnvelope':
      view = await envelopesApi.createConsoleView(user.docusignAccount, { consoleViewRequest: { envelopeId } });
      break;
    case 'makeChanges':
      const lock = await envelopesApi.createLock(user.docusignAccount, envelopeId, { lockRequest: { lockType: "edit", lockDurationInSeconds: "15", lockedByApp: "ChatSign for Docusign" } });
      view = await envelopesApi.createCorrectView(user.docusignAccount, envelopeId, { envelopeViewRequest: { settings: { lockToken: lock.lockToken } } });
      break;
    case 'allOptions':
      view = await envelopesApi.createConsoleView(user.docusignAccount);
      break;
    default:
      throw new Error('Invalid action type');
  }

  return view.url;
};

docusignService.obtainManageData = async (dbConnection, phone, docId) => {
  // Fetch user details from the database
  const [userRows] = await dbConnection.execute(
    'SELECT * FROM user WHERE phone = ?',
    [phone]
  );
  if (userRows.length !== 1) throw Error("No user found");
  const user = userRows[0];

  const { docusignAccount, docusignUser } = user;

  // Initialize DocuSign API client
  const apiClient = await getDocusignApiClient(docusignUser);
  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const envelopeDetails = await envelopesApi.getEnvelope(docusignAccount, docId, { include: ["documents"] });

  // fetch page images concurrently
  const allPages = await pageFetching(docusignAccount, docId, envelopeDetails.envelopeDocuments, apiClient);

  return {
    pages: allPages,
    showCorrectButton: ["sent", "delivered"].includes(envelopeDetails.status),
    filename: envelopeDetails?.envelopeDocuments?.filter(el => el.order === '1')[0]?.name,
  };
}

async function pageFetching(docusignAccount, envelopeId, envelopeDocuments, apiClient) {
  const pagePromises = envelopeDocuments.map(async doc => {
    const docId = doc.documentId;
    const totalPages = doc.pages ? doc.pages.length : 0;

    return Promise.all(
      Array.from({ length: totalPages }, (_, page) => page + 1).map(async page => {
        try {
          const pageUrl = `https://demo.docusign.net/restapi/v2.1/accounts/${docusignAccount}/envelopes/${envelopeId}/documents/${docId}/pages/${page}/page_image?show_changes=true&dpi=72`;

          const response = await fetch(pageUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiClient.defaultHeaders.Authorization.split(' ')[1]}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch page ${page} of document ${docId}: ${response.statusText}`);
          }

          const pageBuffer = await response.buffer();
          const pageBase64 = pageBuffer.toString('base64');

          return {
            documentId: docId,
            pageNumber: page,
            imageBase64: pageBase64,
            documentName: doc.name || 'Document',
          };
        } catch (err) {
          console.error(`Error fetching page ${page} of document ${docId}:`, err.message);
          return null;
        }
      })
    );
  });

  const allPages = (await Promise.all(pagePromises)).flat().filter(Boolean);
  return allPages;
}

docusignService.createDraftEnvelope = async (dbConnection, phone, fileId, recipientsArray, webhookUrl) => {
  try {
    const [docRows] = await dbConnection.execute(
      'SELECT * FROM document INNER JOIN user ON document.phone = user.phone WHERE id = ?',
      [fileId]
    );

    if (!docRows || docRows.length === 0) {
      throw new Error(`User or document not found.`);
    }

    const user = docRows[0];
    const accountId = user.docusignAccount;
    const userId = user.docusignUser;

    const docRow = docRows[0];
    const fieldsExtracted = JSON.parse(docRow.fieldsJson);
    const localFilePath = "./userFiles/" + docRow.fileName;

    if (!fs.existsSync(localFilePath)) {
      throw new Error(`File not found at path: ${localFilePath}`);
    }

    const apiClient = await getDocusignApiClient(userId);

    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const fileContent = fs.readFileSync(localFilePath);
    const document = {
      documentBase64: fileContent.toString('base64'),
      name: docRow.originalFileName,
      fileExtension: path.extname(docRow.originalFileName).substring(1),
      documentId: '1',
    };

    const linkIds = [];
    const mysqlParams = [];

    // map placeholders to tabs
    const signers = recipientsArray.map((recipient, index) => {
      const recipientId = (index + 1).toString();
      const recipientLinkId = short.generate();

      mysqlParams.push("(?, ?, ?)");
      linkIds.push(recipientLinkId, recipientId, fileId);

      const signHereTabs = [];
      const dateSignedTabs = [];
      const textTabs = [];

      (fieldsExtracted.signatures || []).forEach(sig => {
        const match = sig.match(/\[SIGNATURE\s+(\d+)\]/i);
        if (match && match[1] === recipientId) {
          signHereTabs.push({
            anchorString: sig,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '36',
          });
        }
      });

      (fieldsExtracted.dates || []).forEach(dt => {
        const match = dt.match(/\[DATE\s+(\d+)\]/i);
        if (match && match[1] === recipientId) {
          dateSignedTabs.push({
            anchorString: dt,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '12',
            height: "48",
            width: "400",

            fontColor: "black",
            fontSize: "size10",
          });
        }
      });

      (fieldsExtracted.texts || []).forEach(txt => {
        const match = txt.match(/\[TEXT\s+(\d+)([A-Za-z]+)\]/i);
        if (match && match[1] === recipientId) {
          textTabs.push({
            anchorString: txt,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '12',
            height: '12',
            width: '400',
            required: true,
            tabLabel: `Text_${recipientId}_${match[2]}`,

            fontColor: "black",
            fontSize: "size10",
            fontFace: "Arial",
          });
        }
      });

      return {
        clientUserId: recipientLinkId,
        email: recipient.email,
        name: recipient.name,
        recipientId,
        emailNotification: {
          emailSubject: `Please review and sign: ${docRow.originalFileName}`,
          emailBody: `To ask questions about and clarify details of the document, you can visit https://dsbot2.theoleecj.net/docReview/${recipientLinkId}.`,
        },
        routingOrder: recipientId,
        tabs: {
          signHereTabs,
          dateSignedTabs,
          textTabs,
        },
      };
    });

    await dbConnection.execute(`DELETE FROM signer WHERE document = ?`, [fileId]);
    dbConnection.execute(`INSERT INTO signer (id, routingOrder, document) VALUES ${mysqlParams.join(",")}`, linkIds);

    const envelopeDefinition = {
      emailSubject: `Please review and sign: ${docRow.originalFileName}`,
      documents: [document],
      recipients: {
        signers,
      },
      ...(webhookUrl && {
        eventNotification: {
          url: webhookUrl,
          loggingEnabled: false,
          requireAcknowledgment: true,
          includeEnvelopeVoidReason: true,
          includeTimeZone: true,
          includeDocumentFields: true,
          eventData: {
            version: "restv2.1",
            includeData: [
              "recipients",
            ]
          },
          envelopeEvents: [
            { envelopeEventStatusCode: "created" },
            { envelopeEventStatusCode: "sent" },
            { envelopeEventStatusCode: "delivered" },
            { envelopeEventStatusCode: "completed" },
            { envelopeEventStatusCode: "declined" },
            { envelopeEventStatusCode: "voided" },
          ],
          recipientEvents: [
            { recipientEventStatusCode: "Sent" },
            { recipientEventStatusCode: "Delivered" },
            { recipientEventStatusCode: "Completed" },
            { recipientEventStatusCode: "Declined" },
            { recipientEventStatusCode: "AuthenticationFailed" },
            { recipientEventStatusCode: "AutoResponded" },
          ],
        },
      }),
      status: 'created',
    };

    const results = await envelopesApi.createEnvelope(accountId, { envelopeDefinition });
    const envelopeId = results.envelopeId;
    console.log('Draft envelope created. Envelope ID:', envelopeId);

    await dbConnection.execute(
      `UPDATE document SET envelopeId = ?, state = ?, signers = ? WHERE id = ?`,
      [envelopeId, 'draftCreated', JSON.stringify(recipientsArray), fileId]
    );

    return envelopeId;

  } catch (error) {
    console.error('Error in createDraftEnvelope:', error);
    throw error;
  }
};

docusignService.obtainPreviewData = async (dbConnection, fileId) => {
  try {
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

    const [userRows] = await dbConnection.execute(
      `SELECT u.* 
         FROM user u
         JOIN document d ON d.phone = u.phone 
         WHERE d.id = ?`,
      [fileId]
    );
    if (!userRows || userRows.length === 0) {
      throw new Error(`No linked user found for document.id = ${fileId}`);
    }
    const user = userRows[0];
    const { docusignAccount, docusignUser } = user;
    if (!docusignAccount || !docusignUser) {
      throw new Error(`User is missing docusignAccount or docusignUser`);
    }

    // Obtain an authenticated apiClient
    const apiClient = await getDocusignApiClient(docusignUser);

    // Use that client to call the Envelopes API
    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    // Get docs & recipients concurrently
    const [docsResponse, recipientsResponse] = await Promise.all([
      envelopesApi.listDocuments(docusignAccount, envelopeId),
      envelopesApi.listRecipients(docusignAccount, envelopeId),
    ]);

    const envelopeDocuments = docsResponse.envelopeDocuments || [];
    if (envelopeDocuments.length === 0) {
      throw new Error(`No documents found in envelopeId: ${envelopeId}`);
    }

    const signers = recipientsResponse.signers || [];
    const recipientsData = signers.map(signer => ({
      name: signer.name,
      email: signer.email,
      recipientId: signer.recipientIdGuid || signer.recipientId,
    }));

    // fetch tabs for each signer
    const tabPromises = signers.map(async signer => {
      const tabsResponse = await envelopesApi.listTabs(
        docusignAccount,
        envelopeId,
        signer.recipientId
      );

      const flattenTabData = (tabType, tabItems) =>
        (tabItems || []).map(t => ({
          tabType,
          tabLabel: t.tabLabel,
          documentId: t.documentId,
          recipientId: t.recipientIdGuid || signer.recipientIdGuid || t.recipientId,
          xPosition: t.xPosition,
          yPosition: t.yPosition,
          anchorString: t.anchorString,
          pageNumber: t.pageNumber,
        }));

      return [
        ...flattenTabData('signHere', tabsResponse.signHereTabs),
        ...flattenTabData('dateSigned', tabsResponse.dateSignedTabs),
        ...flattenTabData('text', tabsResponse.textTabs),
      ];
    });

    const allTabs = (await Promise.all(tabPromises)).flat();

    // fetch page images concurrently
    const allPages = (await pageFetching(docusignAccount, envelopeId, envelopeDocuments, apiClient));

    // Generate the edit link
    const editLinkPromise = fetch(
      `https://demo.docusign.net/restapi/v2.1/accounts/${docusignAccount}/envelopes/${envelopeId}/views/sender`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiClient.defaultHeaders.Authorization,
        },
        body: JSON.stringify({ returnUrl: `https://dsbot2.theoleecj.net/docPreview#${fileId}` }),
      }
    )
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch edit link: ${response.statusText}`);
        }
        const data = await response.json();
        return data.url;
      })
      .catch(err => {
        console.error('Error fetching edit link:', err.message);
        return null;
      });

    const [editLink] = await Promise.all([editLinkPromise]);

    const previewData = {
      pages: allPages,
      tabs: allTabs,
      recipients: recipientsData,
      editLink,
      filename: envelopeDocuments?.filter(el => el.order === '1')[0]?.name,
    };

    return previewData;
  } catch (err) {
    console.error('Error in obtainPreviewData:', err);
    throw err;
  }
};

module.exports = docusignService;
