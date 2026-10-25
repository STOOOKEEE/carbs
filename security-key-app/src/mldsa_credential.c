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

#ifdef HAVE_MLDSA_CREDENTIALS

#include <string.h>

#include "os.h"
#include "cx.h"

#include "cbip_encode.h"
#include "cose_keys.h"
#include "credential.h"
#include "crypto.h"
#include "mldsa_credential.h"

// Internal SDK header (lib_cxng/src, on the include path, see the Makefile): MLDSA_internal_keygen,
// the deterministic key generation, the only way to get a key pair recoverable from the device
// seed (the public lcx_mldsa.h has the random MLDSA_keygen only). As ledger-app/src/pq/pq_root.c.
#include "cx_mldsa_internal.h"

/*
 * RAM: the secret key (2560 bytes) lives on the stack for the duration of one call and is
 * wiped before returning; the public key is written where the caller needs it (in the COSE
 * key, or in the signature buffer that the signature then overwrites). The low-RAM ML-DSA
 * (HAVE_MLDSA_OPTIMIZATION) keeps its own workspace on the stack too. See CARBS.md.
 */
static int derive_keypair(const uint8_t *nonce, uint8_t *publicKey, uint8_t *secretKey) {
    uint8_t seed[MLDSA_SEEDBYTES];
    cx_err_t error;

    crypto_generate_mldsa_seed(nonce, seed);
    error = MLDSA_internal_keygen(publicKey,
                                  MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE,
                                  secretKey,
                                  MLDSA44_SECRETKEYBYTES,
                                  seed,
                                  MLDSA_44);
    explicit_bzero(seed, sizeof(seed));
    return (error == CX_OK) ? 0 : -1;
}

int mldsa_credential_encode_cose_key(const uint8_t *nonce, uint8_t *buffer, uint32_t bufferLength) {
    cbipEncoder_t encoder;
    uint8_t *publicKey = NULL;
    uint8_t secretKey[MLDSA44_SECRETKEYBYTES];
    int status;

    cbip_encoder_init(&encoder, buffer, bufferLength);
    if (encode_cose_key_akp(&encoder,
                            COSE_ALG_ML_DSA_44,
                            MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE,
                            &publicKey) < 0) {
        PRINTF("ML-DSA public key encoding failed\n");
        return -1;
    }

    status = derive_keypair(nonce, publicKey, secretKey);
    explicit_bzero(secretKey, sizeof(secretKey));
    if (status != 0) {
        PRINTF("ML-DSA key generation failed\n");
        return -1;
    }
    return encoder.offset;
}

int mldsa_credential_sign(const uint8_t *nonce,
                          const uint8_t *message,
                          uint32_t messageLength,
                          uint8_t *signature,
                          uint32_t signatureLength) {
    uint8_t secretKey[MLDSA44_SECRETKEYBYTES];
    size_t length = 0;
    int status = -1;

    if (signatureLength < MLDSA_CREDENTIAL_SIGNATURE_SIZE) {
        return -1;
    }

    // The public key is not needed: the signature buffer holds it until it is overwritten.
    if (derive_keypair(nonce, signature, secretKey) == 0) {
        if (MLDSA_sign(signature,
                       signatureLength,
                       &length,
                       message,
                       messageLength,
                       NULL,
                       0,
                       secretKey,
                       sizeof(secretKey),
                       MLDSA_44) == CX_OK &&
            length == MLDSA_CREDENTIAL_SIGNATURE_SIZE) {
            status = (int) length;
        }
    }
    explicit_bzero(secretKey, sizeof(secretKey));
    if (status < 0) {
        // The SDK leaves rejected candidates (z) in the signature buffer on failure.
        explicit_bzero(signature, signatureLength);
        PRINTF("ML-DSA signature failed\n");
    }
    return status;
}

#endif  // HAVE_MLDSA_CREDENTIALS
