/*******************************************************************************
 *   carbs: ML-DSA-44 root key for XRPL (alphanet KeyType::Dilithium).
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_PQ_ROOT_H
#define LEDGER_APP_XRP_PQ_ROOT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define INS_PQ_GET_PUBLIC_KEY 0x10
#define INS_PQ_SIGN           0x11
#define INS_PQ_GET_SIGNATURE  0x12

/** P1 = chunk index; the first call derives the key. Returns 250-byte chunks of the public key. */
int handle_pq_get_public_key(uint8_t chunk_index);

/** P1: 0 first chunk / 1 next; P2: 0 more / 1 last. On the last chunk the user reviews. */
int handle_pq_sign(uint8_t p1, uint8_t p2, const uint8_t *data, size_t length);

/** P1 = chunk index. Returns 250-byte chunks of the last signature. */
int handle_pq_get_signature(uint8_t chunk_index);

/** Ends a pending review: its approval then signs nothing. Called by reset_transaction_context(). */
void pq_cancel_review(void);

#endif
