import "server-only";

import {
  getDefaultManagerReviewDb,
  type ManagerReviewDb,
  type ManagerReviewQueueRow,
} from "./types";
import { queryReviewQueue } from "./queryReviewQueue";

export type QueryReviewItemInput = {
  organizationId: string;
  reviewItemId: string;
  includeDeleted?: boolean;
};

export async function queryReviewItem(
  input: QueryReviewItemInput,
  db?: ManagerReviewDb
): Promise<ManagerReviewQueueRow | null> {
  const activeDb = db ?? (await getDefaultManagerReviewDb());
  const result = await queryReviewQueue(
    {
      organizationId: input.organizationId,
      page: 1,
      pageSize: 1,
      filters: {
        reviewItemId: input.reviewItemId,
        includeDeleted: input.includeDeleted,
      },
    },
    activeDb
  );

  return result.rows[0] ?? null;
}
