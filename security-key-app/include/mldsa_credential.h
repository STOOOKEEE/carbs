/*
*******************************************************************************
*   carbs: post-quantum credentials for the Ledger App Security Key
*
*  Licensed under the Apache License, Version 2.0 (the "License");
*  you may not use this file except in compliance with the License.
*  You may obtain a copy of the License at
*
*      http://www.apache.org/licenses/LICENSE-2.0
*
*   Unless required by applicable law or agreed to in writing, software
*   distributed under the License is distributed on an "AS IS" BASIS,
*   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*  See the License for the specific language governing permissions and
*   limitations under the License.
********************************************************************************/

#ifndef __MLDSA_CREDENTIAL_H__
#define __MLDSA_CREDENTIAL_H__

#include <stdint.h>

#include <lcx_mldsa.h>

#include "ctap2.h"

/*
 * ML-DSA-44 credentials (COSE algorithm -48).
 *
 * The key pair of a credential is derived from the device, never stored:
 *   xi       = SHA256((3 << 128 | nonce) || privateKeySeed)   (crypto_generate_mldsa_seed)
 *   (pk, sk) = ML-DSA-44.KeyGen_internal(xi)                   (FIPS 204, Algorithm 6)
 * where nonce is the credential's random nonce, carried encrypted in its credential ID (or
 * in the resident key storage), and privateKeySeed comes from the device seed, as for the
 * app's ECDSA credentials. The same credential ID on a device with the same 24 words gives
 * the same key pair.
 *
 * A signature is pure ML-DSA-44 with an empty context over authenticatorData ||
 * clientDataHash, as WebAuthn and the COSE ML-DSA draft specify.
 */

#define MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE MLDSA44_PUBLICKEYBYTES  // 1312
#define MLDSA_CREDENTIAL_SIGNATURE_SIZE  MLDSA44_SIGBYTES        // 2420
#define MLDSA_CREDENTIAL_COSE_KEY_SIZE   (COSE_AKP_HEADER_SIZE + MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE)

/**
 * Encode the COSE AKP public key of the credential of this nonce into buffer, the key
 * generated in place. Returns the encoded length, or -1.
 */
int mldsa_credential_encode_cose_key(const uint8_t *nonce, uint8_t *buffer, uint32_t bufferLength);

/**
 * Sign message with the credential of this nonce. signature must hold
 * MLDSA_CREDENTIAL_SIGNATURE_SIZE bytes. Returns the signature length, or -1.
 */
int mldsa_credential_sign(const uint8_t *nonce,
                          const uint8_t *message,
                          uint32_t messageLength,
                          uint8_t *signature,
                          uint32_t signatureLength);

#endif
