# ChatSign Setup Instructions

**Prerequisites:**

* Node.js and npm
* MySQL server
* DocuSign developer account
* Facebook Business account with WhatsApp Business API access
* OpenAI API key
* Cloned the repository

**2. Install Dependencies:**

```bash
npm install
```

**3. Configuration:**

* **CRITICAL:**  **DO NOT commit any of the following files to your repository.**
* **.env File:** Create a `.env` file in the project's root directory and add the following environment variables (replace the placeholders with your actual values):

```
DB_USER=<your_mysql_user>
DB_PASSWORD=<your_mysql_password>
DB_NAME=<your_mysql_database_name>
INTERNAL_KEY=<your_strong_jwt_secret_key>
LLM_API_KEY=<your_openai_api_key>
DOCUSIGN_INTEGRATION_KEY=<your_docusign_integration_key>
DOCUSIGN_CLIENT_SECRET=<your_docusign_client_secret>
BUSINESS_ACCOUNT_ID=<your_whatsapp_business_account_id>
PHONE_ID=<your_whatsapp_phone_id>
```

* **.fb_token File:** Create a `.fb_token` file in the project's root directory and paste your Facebook token into it.
* **privkey.pem File:** Place your DocuSign private key file `privkey.pem` in the project directory.


**4. Database Setup:**

* Create a MySQL database with the name specified in your `.env` file.
* Setup tables as shown in `tables.sql`

**5. DocuSign Configuration:**

* Configure your DocuSign app's redirect URI to `https://<your-domain>/callback`. Replace `<your-domain>` with the actual domain where your app is hosted.

**6. Start the Server:**

```bash
node dsbot2.js
```

**7. WhatsApp Webhook Setup:**

* Configure the webhook URL in your Facebook Business account to point to `https://<your-domain>/webhookCallback`.