// Package twilio is a tiny REST client for the parts of the Twilio API the app
// needs server-side. Currently that is provider-native outbound caller-ID
// verification via the Outgoing Caller IDs ("Validation Requests") API, which
// lets a user prove ownership of their own phone number so it can be presented
// as the Caller ID on browser→PSTN calls (BYON). No third-party SDK is used —
// the surface is small and a stdlib HTTP client keeps the dependency footprint
// flat (mirrors the Node trunk clients).
package twilio

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const apiBase = "https://api.twilio.com/2010-04-01"

// Client talks to the Twilio REST API using HTTP Basic auth (AccountSID:AuthToken).
type Client struct {
	accountSID string
	authToken  string
	smsFrom    string
	http       *http.Client
}

// NewClient builds a Twilio client. An empty accountSID/authToken yields a
// client whose Enabled() reports false; callers should gate the feature on it.
// smsFrom is the OTP SMS sender (a Twilio number or a "MG..." Messaging Service
// SID); when empty, SMSEnabled() reports false.
func NewClient(accountSID, authToken, smsFrom string) *Client {
	return &Client{
		accountSID: accountSID,
		authToken:  authToken,
		smsFrom:    smsFrom,
		http:       &http.Client{Timeout: 15 * time.Second},
	}
}

// Enabled reports whether Twilio credentials are configured.
func (c *Client) Enabled() bool {
	return c != nil && c.accountSID != "" && c.authToken != ""
}

// SMSEnabled reports whether SMS sending is configured (credentials + a sender).
func (c *Client) SMSEnabled() bool {
	return c.Enabled() && c.smsFrom != ""
}

// SendSMS sends a text message to (E.164) via the Twilio Messages API. The
// configured smsFrom is used as either MessagingServiceSid (when it starts with
// "MG") or From. Returns an error if SMS is not configured.
func (c *Client) SendSMS(ctx context.Context, to, body string) error {
	if !c.SMSEnabled() {
		return fmt.Errorf("twilio: SMS not configured")
	}
	form := url.Values{}
	form.Set("To", to)
	form.Set("Body", body)
	if strings.HasPrefix(c.smsFrom, "MG") {
		form.Set("MessagingServiceSid", c.smsFrom)
	} else {
		form.Set("From", c.smsFrom)
	}
	endpoint := fmt.Sprintf("%s/Accounts/%s/Messages.json", apiBase, c.accountSID)
	return c.do(ctx, http.MethodPost, endpoint, form, nil)
}

// ValidationRequest is the response to creating an Outgoing Caller ID
// validation. Twilio places a call to PhoneNumber; the user must enter
// ValidationCode (which we surface to them) to complete verification.
type ValidationRequest struct {
	AccountSID     string `json:"account_sid"`
	PhoneNumber    string `json:"phone_number"`
	FriendlyName   string `json:"friendly_name"`
	ValidationCode string `json:"validation_code"`
	CallSID        string `json:"call_sid"`
}

// OutgoingCallerID is a verified caller-ID resource on the account.
type OutgoingCallerID struct {
	SID          string `json:"sid"`
	PhoneNumber  string `json:"phone_number"`
	FriendlyName string `json:"friendly_name"`
}

type outgoingCallerIDList struct {
	OutgoingCallerIDs []OutgoingCallerID `json:"outgoing_caller_ids"`
}

// twilioError mirrors Twilio's error envelope for clearer messages.
type twilioError struct {
	Code     int    `json:"code"`
	Message  string `json:"message"`
	MoreInfo string `json:"more_info"`
	Status   int    `json:"status"`
}

// CreateValidationRequest starts verification of phoneNumber (E.164). Twilio
// calls the number and the returned ValidationCode must be entered by the user.
func (c *Client) CreateValidationRequest(ctx context.Context, phoneNumber, friendlyName string) (*ValidationRequest, error) {
	form := url.Values{}
	form.Set("PhoneNumber", phoneNumber)
	if friendlyName != "" {
		form.Set("FriendlyName", friendlyName)
	}

	endpoint := fmt.Sprintf("%s/Accounts/%s/OutgoingCallerIds.json", apiBase, c.accountSID)
	var out ValidationRequest
	if err := c.do(ctx, http.MethodPost, endpoint, form, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// FindOutgoingCallerID returns the verified caller-ID resource for phoneNumber,
// or nil if the number has not (yet) been verified on the account.
func (c *Client) FindOutgoingCallerID(ctx context.Context, phoneNumber string) (*OutgoingCallerID, error) {
	endpoint := fmt.Sprintf("%s/Accounts/%s/OutgoingCallerIds.json?PhoneNumber=%s",
		apiBase, c.accountSID, url.QueryEscape(phoneNumber))
	var out outgoingCallerIDList
	if err := c.do(ctx, http.MethodGet, endpoint, nil, &out); err != nil {
		return nil, err
	}
	for i := range out.OutgoingCallerIDs {
		if out.OutgoingCallerIDs[i].PhoneNumber == phoneNumber {
			return &out.OutgoingCallerIDs[i], nil
		}
	}
	if len(out.OutgoingCallerIDs) > 0 {
		return &out.OutgoingCallerIDs[0], nil
	}
	return nil, nil
}

// DeleteOutgoingCallerID removes a verified caller-ID resource by SID so the
// user can verify a different number.
func (c *Client) DeleteOutgoingCallerID(ctx context.Context, sid string) error {
	endpoint := fmt.Sprintf("%s/Accounts/%s/OutgoingCallerIds/%s.json", apiBase, c.accountSID, url.PathEscape(sid))
	return c.do(ctx, http.MethodDelete, endpoint, nil, nil)
}

// do performs an authenticated request, decoding a JSON body into out (when
// non-nil) and mapping Twilio error envelopes to a descriptive error.
func (c *Client) do(ctx context.Context, method, endpoint string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.accountSID, c.authToken)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var te twilioError
		if json.Unmarshal(data, &te) == nil && te.Message != "" {
			return fmt.Errorf("twilio %d: %s", resp.StatusCode, te.Message)
		}
		return fmt.Errorf("twilio request failed: %s", resp.Status)
	}

	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("twilio: decode response: %w", err)
		}
	}
	return nil
}
