import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { requireManager } from '@/lib/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authorize from the database, not the cookie.
  //
  // This used to read `auth()` and test the role claim inside the JWT. Sessions here are
  // stateless, so that token is a statement about who the user *was* when it was minted:
  // a deactivated, demoted or signed-out-all account kept working until it expired. Verified
  // before the change — a deactivated team lead holding a live token successfully raised a
  // mailbox's daily send cap and got a 200 back, while every other route correctly refused
  // the same token with 401.
  //
  // `requireManager` goes through `getSessionUser`, which re-reads the row and matches
  // `authVersion`, so revocation applies here like everywhere else. It also returns **403**
  // for a role failure, which is the convention the rest of the codebase follows; the old
  // code answered 401 and so reported "not signed in" to a user who was.
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;
  
  try {
    const body = await req.json();
    const dailyCap = Number(body.dailyCap);
    
    if (isNaN(dailyCap) || dailyCap < 1) {
      return NextResponse.json({ error: 'Invalid daily cap' }, { status: 400 });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { tenantId: true },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    await tenantStorage.run({ tenantId: account.tenantId }, async () => {
      await prisma.emailAccount.update({
        where: { id },
        data: { dailyCap },
      });
    });

    return NextResponse.json({ success: true, dailyCap });
  } catch (error) {
    console.error('[automation-account-cap] Failed to update cap:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
