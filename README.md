[![Click to watch ChatSign video](https://i.imgur.com/6OVeHjW.png)](https://www.youtube.com/watch?v=ruz7TEFnJI4)

Click to watch video: https://www.youtube.com/watch?v=ruz7TEFnJI4

## Inspiration

Small businesses often conduct business on disparate platforms like email and WhatsApp due to their convenience and ubiquity. This leads to the **agreement trap, where valuable agreement data is trapped inside myriad disorganized systems**, hindering decision making and lowering efficiency.

In the face of this problem, we wondered if we could present Docusign's Intelligent Agreement Management to small businesses with a familiar chat-based user experience, helping them reap the benefits of IAM using simple and intuitive text messages.

## What it does

ChatSign enables small businesses to create, ask questions about, manage and sign agreements with nothing more than a convenient WhatsApp message, acting as a personal assistant for agreements.

### Testing Instructions

If you wish to test the deployed version of ChatSign, please send me an email at **theodorelcj at gmail.com** with up to 3 WhatsApp phone numbers to add for testing. This is necessary as WhatsApp imposes strict restrictions on apps that are not in production yet, requiring pre-verification of phone numbers before interacting with pre-production apps.

### AI Agreements Knowledgebase Agent

![AI Agreements Knowledgebase Agent Screenshot](https://i.imgur.com/Cvbyjy0.png)

ChatSign's main feature - our agreements knowledgebase agent - leverages Docusign Navigator's ability to analyze many agreement types and cutting-edge large language models. It accepts natural language questions from users about their agreements, connecting to the Navigator API to provide immediate answers.

The agent is also able to **browse agreements autonomously** when more information is needed, **conducting searches on Navigator** to narrow down the list of relevant agreements and **requesting and parsing the full text** of selected agreements to provide detailed, focused answers.

### AI Agreement QnA Bot

![AI Agreement QnA Bot GIF](https://i.imgur.com/PG3QBbj.gif)

ChatSign also empowers recipients to understand their agreements better with an AI chatbot which answers questions about a particular agreement. Crucially, we designed the chatbot to always **support its answers with direct quotes from the agreement whenever possible**, reducing AI hallucinations and ensuring its responses are grounded in the actual text of the agreement.

Our carefully engineered system prompt ensures that the chatbot knows when to advise recipients to discuss matters with the sender.

### Chat-based Guided Envelope Creation

![Envelope Creation Screenshot](https://i.imgur.com/xlbCqxd.png)

ChatSign provides users with a guided envelope creation experience, with a simple syntax for inserting signature and form fields and a list of templates from Docusign to help users create agreements faster.

## How we built it

ChatSign started with a robust foundation, built on a collection of Docusign API calls that adhere to best practices. We joined the Docusign Navigator API beta program to build on Navigator's ability to extract structured data from a wide range of agreement types.

Then, we integrated these into an intuitive WhatsApp chatbot flow built using Fastify on Node.js, storing state and user data in MySQL. Next, user interfaces such as the Recipient QnA Bot UI were created using TailwindCSS, PDF.js and Vue, with an emphasis on user-friendliness and performance using industry-standard frameworks and design practices.

## Challenges we ran into

### User Experience Design
Designing an intuitive chatbot experience requires much fine-tuning and testing, which was time-consuming to carry out. Implementing improvements to the chat flow requires accounting for corner cases too, necessitating great attention to detail.

### Prompt Engineering
Reducing AI hallucinations in the QnA chatbot was a key priority for the project. Therefore, we iterated on our system prompt many times with various instructions before coming to a system prompt that remained cost-effective while minimising hallucinations and grounding the chatbot's response in the agreement's text.

## Accomplishments that we're proud of

### Intuitive User Experience
We are proud that the many hours of work put into fine-tuning the user experience, right down to simple details such as how the QnA chatbot's response "streams" in and highlights relevant quotes in an agreement with a subtle animation, have resulted in a delightful and intuitive user experience.

## What we learned

### Docusign APIs
We learnt how to build a robust integration with the Docusign platform which follows best practices, such as using Docusign Connect instead of polling API endpoints.

## What's next for ChatSign

We plan to enhance the ChatSign AI Agent with additional tools to better assist users, such as potential integrations with Docusign CLM or even integrations to support real estate agents - many of whom rely on WhatsApp in Asia - using Docusign's Rooms API.
