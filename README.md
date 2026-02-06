# FairVote

Create private elections with Google sign-in, email-based eligibility, and anonymous results.

## Features

- Google sign-in for voters and electors.
- Elector defines candidates, max selections, and eligible email list.
- Voters can select 1..N options, no duplicates.
- Elector can see who voted, but not who they voted for.

## Setup

1. Create a Firebase project and add a Web App.
2. Enable Google sign-in under Firebase Authentication.
3. Create a Firestore database.
4. Copy `.env.local.example` to `.env.local` and fill in your Firebase config.

```bash
npm run dev
```

Open `http://localhost:3000`.

If Firestore prompts for an index (for the eligible elections query), click the
provided link to create it.

## Firestore Data Model

- `elections/{electionId}`
  - `title`, `createdByUid`, `createdByEmail`
  - `maxSelections`
  - `candidates` (array)
  - `eligibleEmails` (array, lowercased)
  - `isClosed` (boolean)
  - `resultsPublished` (boolean)
- `results/{electionId}`
  - `title`
  - `candidates` (array)
  - `counts` (map)
  - `totalVotes` (number)
  - `isPublished` (boolean)
  - `isClosed` (boolean)
  - `createdByUid`
- `votes/{electionId}_{voterUid}`
  - `electionId`, `voterUid`, `voterEmail`
  - `selections` (array)

## Suggested Firestore Rules (starter)

Use this as a baseline and adjust for production needs:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /elections/{electionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null
        && request.auth.uid == resource.data.createdByUid;
    }

    match /votes/{voteId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null
        && request.auth.uid == resource.data.voterUid;
    }

    match /results/{electionId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.createdByUid == request.auth.uid;
      allow update: if request.auth != null;
      allow delete: if request.auth != null
        && request.auth.uid == resource.data.createdByUid;
    }
  }
}
```

## Public Results Page

The public results page is available at `/elections/[id]/results`. It reads from
the safe `results/{electionId}` document and shows only aggregated counts (no
voter list). You can keep `elections` and `votes` private while allowing public
read access to `results`.

Note: In this frontend-only version, the client updates `results` on each vote,
so updates must be allowed for authenticated users. For tamper-proof counts,
move this aggregation into a trusted server or Cloud Function.
