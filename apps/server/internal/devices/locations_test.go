package devices

import "testing"

func TestNormalizeLocationInput(t *testing.T) {
	latitude, longitude := 34.175, -82.024
	input, err := normalizeLocationInput(LocationInput{
		Name:     "  Edgewood Middle School ",
		City:     " Ninety Six ",
		State:    " SC ",
		Latitude: &latitude, Longitude: &longitude,
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Name != "Edgewood Middle School" || input.City != "Ninety Six" || input.State != "SC" {
		t.Fatalf("location fields were not normalized: %#v", input)
	}
}

func TestNormalizeLocationInputRejectsInvalidCoordinates(t *testing.T) {
	latitude, longitude := 91.0, -181.0
	if _, err := normalizeLocationInput(LocationInput{Name: "School", Latitude: &latitude}); err == nil {
		t.Fatal("expected invalid latitude to be rejected")
	}
	if _, err := normalizeLocationInput(LocationInput{Name: "School", Longitude: &longitude}); err == nil {
		t.Fatal("expected invalid longitude to be rejected")
	}
}
