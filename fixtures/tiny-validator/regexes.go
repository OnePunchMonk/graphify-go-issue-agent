package validator

import "regexp"

var hostnameRegex = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)
