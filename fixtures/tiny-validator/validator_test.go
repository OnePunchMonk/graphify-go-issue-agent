package validator

import "testing"

func TestHostnameRFC1123Validation(t *testing.T) {
	if !isHostnameRFC1123("example.com") {
		t.Fatal("expected hostname to validate")
	}
}

func TestCountryCodeValidation(t *testing.T) {
	if !isCountryCode("US") {
		t.Fatal("expected country code to validate")
	}
}
