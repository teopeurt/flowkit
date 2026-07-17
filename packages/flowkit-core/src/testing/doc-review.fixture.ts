import { defineFlow } from '../schema';

export const docReviewFlow = defineFlow({
  id: 'document-review',
  version: 1,
  roles: ['author', 'reviewer'],
  tracks: {
    visibility: {
      initial: 'private',
      values: ['private', 'public'],
    },
  },
  initialStage: 'draft',
  initialStatus: 'pending',
  stages: {
    draft: {
      pendingRole: 'author',
      actions: {
        submit: {
          to: 'review',
        },
      },
    },
    review: {
      pendingRole: 'reviewer',
      actions: {
        publish: {
          to: 'published',
          status: 'approved',
          tracks: {
            visibility: 'public',
          },
          guards: ['commentRequired'],
          policy: 'reviewerOnly',
        },
      },
    },
    published: {
      final: true,
    },
  },
});
