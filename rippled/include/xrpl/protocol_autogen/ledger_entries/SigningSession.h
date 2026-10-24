// This file is auto-generated. Do not edit.
#pragma once

#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STParsedJSON.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/protocol_autogen/LedgerEntryBase.h>
#include <xrpl/protocol_autogen/LedgerEntryBuilderBase.h>
#include <xrpl/json/json_value.h>

#include <stdexcept>
#include <optional>

namespace xrpl::ledger_entries {

class SigningSessionBuilder;

/**
 * @brief Ledger Entry: SigningSession
 *
 * Type: ltSIGNING_SESSION (0x009A)
 * RPC Name: signing_session
 *
 * Immutable wrapper around SLE providing type-safe field access.
 * Use SigningSessionBuilder to construct new ledger entries.
 */
class SigningSession : public LedgerEntryBase
{
public:
    static constexpr LedgerEntryType entryType = ltSIGNING_SESSION;

    /**
     * @brief Construct a SigningSession ledger entry wrapper from an existing SLE object.
     * @throws std::runtime_error if the ledger entry type doesn't match.
     */
    explicit SigningSession(SLE::const_pointer sle)
        : LedgerEntryBase(std::move(sle))
    {
        // Verify ledger entry type
        if (sle_->getType() != entryType)
        {
            throw std::runtime_error("Invalid ledger entry type for SigningSession");
        }
    }

    // Ledger entry-specific field getters

    /**
     * @brief Get sfAccount (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_ACCOUNT::type::value_type
    getAccount() const
    {
        return this->sle_->at(sfAccount);
    }

    /**
     * @brief Get sfSessionKey (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_ACCOUNT::type::value_type
    getSessionKey() const
    {
        return this->sle_->at(sfSessionKey);
    }

    /**
     * @brief Get sfExpiration (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_UINT32::type::value_type
    getExpiration() const
    {
        return this->sle_->at(sfExpiration);
    }

    /**
     * @brief Get sfPermissions (SoeOptional)
     * @note This is an untyped field (unknown).
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    std::optional<std::reference_wrapper<STArray const>>
    getPermissions() const
    {
        if (this->sle_->isFieldPresent(sfPermissions))
            return this->sle_->getFieldArray(sfPermissions);
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
        return this->sle_->isFieldPresent(sfPermissions);
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
            return this->sle_->at(sfSessionCap);
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
        return this->sle_->isFieldPresent(sfSessionCap);
    }

    /**
     * @brief Get sfSessionSpent (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_AMOUNT::type::value_type>
    getSessionSpent() const
    {
        if (hasSessionSpent())
            return this->sle_->at(sfSessionSpent);
        return std::nullopt;
    }

    /**
     * @brief Check if sfSessionSpent is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasSessionSpent() const
    {
        return this->sle_->isFieldPresent(sfSessionSpent);
    }

    /**
     * @brief Get sfOwnerNode (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_UINT64::type::value_type
    getOwnerNode() const
    {
        return this->sle_->at(sfOwnerNode);
    }

    /**
     * @brief Get sfPreviousTxnID (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_UINT256::type::value_type
    getPreviousTxnID() const
    {
        return this->sle_->at(sfPreviousTxnID);
    }

    /**
     * @brief Get sfPreviousTxnLgrSeq (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_UINT32::type::value_type
    getPreviousTxnLgrSeq() const
    {
        return this->sle_->at(sfPreviousTxnLgrSeq);
    }
};

/**
 * @brief Builder for SigningSession ledger entries.
 *
 * Provides a fluent interface for constructing ledger entries with method chaining.
 * Uses STObject internally for flexible ledger entry construction.
 * Inherits common field setters from LedgerEntryBuilderBase.
 */
class SigningSessionBuilder : public LedgerEntryBuilderBase<SigningSessionBuilder>
{
public:
    /**
     * @brief Construct a new SigningSessionBuilder with required fields.
     * @param account The sfAccount field value.
     * @param sessionKey The sfSessionKey field value.
     * @param expiration The sfExpiration field value.
     * @param ownerNode The sfOwnerNode field value.
     * @param previousTxnID The sfPreviousTxnID field value.
     * @param previousTxnLgrSeq The sfPreviousTxnLgrSeq field value.
     */
    SigningSessionBuilder(std::decay_t<typename SF_ACCOUNT::type::value_type> const& account,std::decay_t<typename SF_ACCOUNT::type::value_type> const& sessionKey,std::decay_t<typename SF_UINT32::type::value_type> const& expiration,std::decay_t<typename SF_UINT64::type::value_type> const& ownerNode,std::decay_t<typename SF_UINT256::type::value_type> const& previousTxnID,std::decay_t<typename SF_UINT32::type::value_type> const& previousTxnLgrSeq)
        : LedgerEntryBuilderBase<SigningSessionBuilder>(ltSIGNING_SESSION)
    {
        setAccount(account);
        setSessionKey(sessionKey);
        setExpiration(expiration);
        setOwnerNode(ownerNode);
        setPreviousTxnID(previousTxnID);
        setPreviousTxnLgrSeq(previousTxnLgrSeq);
    }

    /**
     * @brief Construct a SigningSessionBuilder from an existing SLE object.
     * @param sle The existing ledger entry to copy from.
     * @throws std::runtime_error if the ledger entry type doesn't match.
     */
    SigningSessionBuilder(SLE::const_pointer sle)
    {
        if (sle->at(sfLedgerEntryType) != ltSIGNING_SESSION)
        {
            throw std::runtime_error("Invalid ledger entry type for SigningSession");
        }
        object_ = *sle;
    }

    /**
     * @brief Ledger entry-specific field setters
     */

    /**
     * @brief Set sfAccount (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setAccount(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfAccount] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionKey (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setSessionKey(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfSessionKey] = value;
        return *this;
    }

    /**
     * @brief Set sfExpiration (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setExpiration(std::decay_t<typename SF_UINT32::type::value_type> const& value)
    {
        object_[sfExpiration] = value;
        return *this;
    }

    /**
     * @brief Set sfPermissions (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setPermissions(STArray const& value)
    {
        object_.setFieldArray(sfPermissions, value);
        return *this;
    }

    /**
     * @brief Set sfSessionCap (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setSessionCap(std::decay_t<typename SF_AMOUNT::type::value_type> const& value)
    {
        object_[sfSessionCap] = value;
        return *this;
    }

    /**
     * @brief Set sfSessionSpent (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setSessionSpent(std::decay_t<typename SF_AMOUNT::type::value_type> const& value)
    {
        object_[sfSessionSpent] = value;
        return *this;
    }

    /**
     * @brief Set sfOwnerNode (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setOwnerNode(std::decay_t<typename SF_UINT64::type::value_type> const& value)
    {
        object_[sfOwnerNode] = value;
        return *this;
    }

    /**
     * @brief Set sfPreviousTxnID (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setPreviousTxnID(std::decay_t<typename SF_UINT256::type::value_type> const& value)
    {
        object_[sfPreviousTxnID] = value;
        return *this;
    }

    /**
     * @brief Set sfPreviousTxnLgrSeq (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionBuilder&
    setPreviousTxnLgrSeq(std::decay_t<typename SF_UINT32::type::value_type> const& value)
    {
        object_[sfPreviousTxnLgrSeq] = value;
        return *this;
    }

    /**
     * @brief Build and return the completed SigningSession wrapper.
     * @param index The ledger entry index.
     * @return The constructed ledger entry wrapper.
     */
    SigningSession
    build(uint256 const& index)
    {
        return SigningSession{std::make_shared<SLE>(std::move(object_), index)};
    }
};

}  // namespace xrpl::ledger_entries
