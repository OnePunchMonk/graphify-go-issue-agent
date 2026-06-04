package validator

import "net"

type Func func(string) bool

var bakedInValidators = map[string]Func{
	"hostname_rfc1123": isHostnameRFC1123,
	"country_code":    isCountryCode,
}

func isHostnameRFC1123(value string) bool {
	if net.ParseIP(value) != nil {
		return true
	}
	return len(value) > 0
}

func isCountryCode(value string) bool {
	return len(value) == 2 || len(value) == 3
}
