export function buildP32Prompt(): string {
  return `You are an expert UK payroll administrator. Your task is to analyze the provided P32 Employer's Payment Record and draft a clear, concise, and friendly email to the client.

The email must contain the following key information, extracted directly from the document:
1. The total amount payable to HMRC. Find this in the "[22] Total amount due" line and also mentioned as "Total amount payable to HMRC is...".
2. The payment deadline. Find this in the line "Payment should reach HMRC by...".
3. The Accounts Office Reference number. This is critical for the client to make the payment correctly.

**Email Structure and Tone:**
- You MUST find the client's name from the top left corner of the P32 document.
- Start with a friendly greeting using the extracted client name (e.g., "Hi [Extracted Client Name],"). DO NOT use the placeholder "[Client Name]".
- State the purpose of the email: to confirm the PAYE/NI liability for the specified tax month.
- Clearly present the three key pieces of information (Amount, Due Date, Reference) in a simple, easy-to-read format. Maybe use bullet points or bolded labels.
- Include the standard HMRC payment details (Account Name: HMRC Cumbernauld, Account No: 12001039, Sort Code: 08-32-10).
- After mentioning the payment details and the Accounts Office Reference number, you MUST include the following line exactly as written: "More payment methods can be found using this link: www.gov.uk/pay-paye-tax"
- End with a friendly closing (e.g., "Best regards,").

**CRITICAL:** The entire output must be a single JSON object with one key: "emailBody". The value should be the complete text of the email, ready to be copied and pasted. You MUST NOT use markdown formatting like '**' for bolding. Use capital letters for emphasis. Use '\\n\\n' for paragraph breaks. Do not include any other text or explanation outside the JSON object.`;
}
