## Important notes / next improvements

### DKIM signing
This starter **generates DKIM keys** and shows DNS records, but it does not yet DKIM-sign outbound messages.
You can add DKIM signing in two ways:
1) Sign at the MTA layer (recommended): Postfix/Exim with OpenDKIM.
2) Sign in-app: use a DKIM signer library for NodeMailer and load private key from `Domain.dkimPrivate`.

### Reply detection
This starter doesn't yet connect to IMAP to mark replies automatically.
Common approach:
- Add IMAP creds per mailbox
- Poll inbox every N minutes and parse In-Reply-To / References headers, match to Message.messageId
- Mark Enrollment stopped on reply (if enabled)

### Deliverability
For real cold mailing:
- rotate content variants
- throttle per mailbox
- warm-up sender domains/IPs
- monitor bounces and complaints

