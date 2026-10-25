// This file is auto-generated. Do not edit.
#pragma once

#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/STParsedJSON.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/protocol_autogen/TransactionBase.h>
#include <xrpl/protocol_autogen/TransactionBuilderBase.h>
#include <xrpl/json/json_value.h>

#include <stdexcept>
#include <optional>

namespace xrpl::transactions {

class SigningSessionSetBuilder;

/**
 * @brief Transaction: SigningSessionSet
 *
 * Type: ttSIGNING_SESSION_SET (130)
 * Delegable: Delegation::NotDelegable
 * Amendment: featureSigningSessions
 * Privileges: Privilege::NoPriv
 *
 * Immutable wrapper around STTx providing type-safe field access.
 * Use SigningSessionSetBuilder to construct new transactions.
 */
class SigningSessionSet : public TransactionBase
{
public:
    static constexpr xrpl::TxType txType = ttSIGNING_SESSION_SET;

    /**
     * @brief Construct a SigningSessionSet transaction wrapper from an existing STTx object.
     * @throws std::runtime_error if the transaction type doesn't match.
     */
    explicit SigningSessionSet(std::shared_ptr<STTx const> tx)
        : TransactionBase(std::move(tx))
    {
        // Verify transaction type
        if (tx_->getTxnType() != txType)
        {
            throw std::runtime_error("Invalid transaction type for SigningSessionSet");
        }
    }

    // Transaction-specific field getters

    /**
     * @brief Get sfSessionKey (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_ACCOUNT::type::value_type
    getSessionKey() const
    {
        return this->tx_->at(sfSessionKey);
    }

    /**
     * @brief Get sfSessionDuration (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_UINT32::type::value_type
    getSessionDuration() const
    {
        return this->tx_->at(sfSessionDuration);
    }
    /**
     * @brief Get sfPermissions (SoeOptional)
     * @note This is an untyped field.
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    std::optional<std::reference_wrapper<STArray const>>
    getPermissions() const
    {
        if (this->tx_->isFieldPresent(sfPermissions))
            return this->tx_->getFieldArray(sfPermissions);
        return std::nullopt;
    }

    /**
     * @brief Check if sfPermissions is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasPermissions() const
    {
        return this->tx_->isFieldPresent(sfPermissions);
    }

    /**
     * @brief Get sfSessionCap (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_AMOUNT::type::value_type>
    getSessionCap() const
    {
        if (hasSessionCap())
        {
            return this->tx_->at(sfSessionCap);
        }
        return std::nullopt;
    }

    /**
     * @brief Check if sfSessionCap is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasSessionCap() const
    {
        return this->tx_->isFieldPresent(sfSessionCap);
    }

    /**
     * @brief Get sfSessionMaxPerTx (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_AMOUNT::type::value_type>
    getSessionMaxPerTx() const
    {
        if (hasSessionMaxPerTx())
        {
            return this->tx_->at(sfSessionMaxPerTx);
        }
        return std::nullopt;
    }

    /**
     * @brief Check if sfSessionMaxPerTx is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasSessionMaxPerTx() const
    {
        return this->tx_->isFieldPresent(sfSessionMaxPerTx);
    }

    /**
     * @brief Get sfSessionWitness (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_ACCOUNT::type::value_type>
    getSessionWitness() const
    {
        if (hasSessionWitness())
        {
            return this->tx_->at(sfSessionWitness);
        }
        return std::nullopt;
    }

    /**
     * @brief Check if sfSessionWitness is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasSessionWitness() const
    {
        return this->tx_->isFieldPresent(sfSessionWitness);
    }

    /**
     * @brief Get sfSessionMaxTxCount (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_UINT32::type::value_type>
    getSessionMaxTxCount() const
    {
        if (hasSessionMaxTxCount())
        {
            return this->tx_->at(sfSessionMaxTxCount);
        }
        return std::nullopt;
    }

    /**
     * @brief Check if sfSessionMaxTxCount is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasSessionMaxTxCount() const
    {
        return this->tx_->isFieldPresent(sfSessionMaxTxCount);
    }
};

/**
 * @brief Builder for SigningSessionSet transactions.
 *
 * Provides a fluent interface for constructing transactions with method chaining.
 * Uses STObject internally for flexible transaction construction.
 * Inherits common field setters from TransactionBuilderBase.
 */
class SigningSessionSetBuilder : public TransactionBuilderBase<SigningSessionSetBuilder>
{
public:
    /**
     * @brief Construct a new SigningSessionSetBuilder with required fields.
     * @param account The account initiating the transaction.
     * @param sessionKey The sfSessionKey field value.
     * @param sessionDuration The sfSessionDuration field value.
     * @param sequence Optional sequence number for the transaction.
     * @param fee Optional fee for the transaction.
     */
    SigningSessionSetBuilder(SF_ACCOUNT::type::value_type account,
                     std::decay_t<typename SF_ACCOUNT::type::value_type> const& sessionKey,                     std::decay_t<typename SF_UINT32::type::value_type> const& sessionDuration,                    std::optional<SF_UINT32::type::value_type> sequence = std::nullopt,
                    std::optional<SF_AMOUNT::type::value_type> fee = std::nullopt
)
        : TransactionBuilderBase<SigningSessionSetBuilder>(ttSIGNING_SESSION_SET, account, sequence, fee)
    {
        setSessionKey(sessionKey);
        setSessionDuration(sessionDuration);
    }

    /**
     * @brief Construct a SigningSessionSetBuilder from an existing STTx object.
     * @param tx The existing transaction to copy from.
     * @throws std::runtime_error if the transaction type doesn't match.
     */
    SigningSessionSetBuilder(std::shared_ptr<STTx const> tx)
    {
        if (tx->getTxnType() != ttSIGNING_SESSION_SET)
        {
            throw std::runtime_error("Invalid transaction type for SigningSessionSetBuilder");
        }
        object_ = *tx;
    }

    /**
     * @brief Transaction-specific field setters
     */

    /**
     * @brief Set sfSessionKey (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionKey(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfSessionKey] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionDuration (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionDuration(std::decay_t<typename SF_UINT32::type::value_type> const& value)
    {
        object_[sfSessionDuration] = value;
        return *this;
    }

    /**
     * @brief Set sfPermissions (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setPermissions(STArray const& value)
    {
        object_.setFieldArray(sfPermissions, value);
        return *this;
    }

    /**
     * @brief Set sfSessionCap (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionCap(std::decay_t<typename SF_AMOUNT::type::value_type> const& value)
    {
        object_[sfSessionCap] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionMaxPerTx (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionMaxPerTx(std::decay_t<typename SF_AMOUNT::type::value_type> const& value)
    {
        object_[sfSessionMaxPerTx] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionWitness (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionWitness(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfSessionWitness] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionMaxTxCount (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionSetBuilder&
    setSessionMaxTxCount(std::decay_t<typename SF_UINT32::type::value_type> const& value)
    {
        object_[sfSessionMaxTxCount] = value;
        return *this;
    }

    /**
     * @brief Build and return the SigningSessionSet wrapper.
     * @param publicKey The public key for signing.
     * @param secretKey The secret key for signing.
     * @return The constructed transaction wrapper.
     */
    SigningSessionSet
    build(PublicKey const& publicKey, SecretKey const& secretKey)
    {
        sign(publicKey, secretKey);
        return SigningSessionSet{std::make_shared<STTx>(std::move(object_))};
    }
};

}  // namespace xrpl::transactions
