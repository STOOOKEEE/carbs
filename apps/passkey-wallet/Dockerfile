# The test wallet: static page + faucet, served by Node (type stripping, Node >= 22.18).
# It depends on the workspace package @carbs/ledger, so it is built from the repository root:
#   docker build -f apps/passkey-wallet/Dockerfile .

FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ledger packages/ledger
COPY apps/passkey-wallet apps/passkey-wallet
RUN pnpm install --frozen-lockfile --filter "@carbs/passkey-wallet..." \
  && pnpm --filter @carbs/passkey-wallet build
WORKDIR /repo/apps/passkey-wallet
USER node
CMD ["node", "server/server.ts"]
