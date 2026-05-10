import Link from "next/link";
import { Container, Card, Button } from "@/components/ui";

export default function SetupPage() {
  return (
    <Container>
      <div className="max-w-4xl mx-auto grid gap-6">
        <Card
          title="Setup command center"
          subtitle="Copy-paste friendly commands to get ColdMail Pro running with web, worker, database, and production notes."
          right={
            <Link href="/login">
              <Button variant="ghost">Back to login</Button>
            </Link>
          }
        >
          <pre className="text-xs whitespace-pre-wrap bg-slate-950 text-slate-50 p-5 rounded-[1.5rem] shadow-inner overflow-x-auto">
{`cp .env.example .env
# edit DATABASE_URL, JWT_SECRET, PUBLIC_APP_URL

npm install
npm run prisma:generate
# If you don't have migrations yet:
# npx prisma db push
npm run seed

# Run web
npm run dev

# In another terminal run worker
npm run worker:dev`}
          </pre>
          <div className="mt-4 text-sm text-slate-600">
            After boot, open <span className="font-mono">/login</span> and sign in. For production, use <span className="font-mono">npm run build</span> then <span className="font-mono">npm run start</span>.
          </div>
        </Card>

        <Card title="Common gotchas">
          <ul className="grid gap-2 text-sm text-slate-700">
            <li>• SMTP: use <span className="font-mono">587</span> with STARTTLS (SSL unchecked) or <span className="font-mono">465</span> with SSL checked.</li>
            <li>• Gmail/Outlook often require app passwords + SMTP/IMAP enabled for your tenant.</li>
            <li>• If your DB is new, run <span className="font-mono">npx prisma db push</span> once.</li>
          </ul>
        </Card>
      </div>
    </Container>
  );
}
