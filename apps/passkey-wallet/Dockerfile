# The test wallet: static page + faucet, served by Node (type stripping, Node >= 22.18).
# It depends on the workspace packages @carbs/ledger, @carbs/sessions (packages/core) and
# @carbs/device-signer-kit-xrp (packages/signer-kit-xrp, Ledger's XRP signer kit extended, built
# by its prepare script during the install), and its stage pages take the art direction of apps/web (the
# token file and the self-hosted fonts), so it is built from the repository root:
#   docker build -f apps/passkey-wallet/Dockerfile .

FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/ledger packages/ledger
COPY packages/signer-kit-xrp packages/signer-kit-xrp
COPY apps/passkey-wallet apps/passkey-wallet
COPY apps/web/assets/tokens.css apps/web/assets/tokens.css
COPY apps/web/public apps/web/public
RUN pnpm install --frozen-lockfile --filter "@carbs/passkey-wallet..." \
  && pnpm --filter @carbs/passkey-wallet build
WORKDIR /repo/apps/passkey-wallet
USER node
CMD ["node", "server/server.ts"]
