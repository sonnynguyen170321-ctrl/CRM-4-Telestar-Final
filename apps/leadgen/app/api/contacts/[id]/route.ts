import { getContact } from "@/lib/server/contacts/contacts";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const contact = await getContact(id);
    if (!contact) {
      return errorResponse("Contact not found.", 404);
    }

    return ok(contact);
  } catch (error) {
    return serverError(error);
  }
}

