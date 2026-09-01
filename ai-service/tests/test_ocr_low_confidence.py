from ocr_service import _extract_low_confidence_words, OCR_LOW_CONFIDENCE_THRESHOLD


def test_mixed_confidence_html_returns_only_low_confidence_word():
    html = '''
    <span data-bbox="1 1 2 2" data-confidence="0.99">Clearly</span>
    <span data-bbox="3 3 4 4" data-confidence="0.4">scrawled</span>
    <span data-bbox="5 5 6 6" data-confidence="1">word</span>
    '''
    assert _extract_low_confidence_words(html) == [{"word": "scrawled", "confidence": 0.4}]


def test_html_with_no_confidence_attrs_returns_empty_list():
    html = "<p><span>plain</span> <b>text</b></p>"
    assert _extract_low_confidence_words(html) == []


def test_empty_string_returns_empty_list():
    assert _extract_low_confidence_words("") == []


def test_malformed_confidence_value_is_skipped_not_raised():
    html = '<span data-confidence="notanumber">oops</span>'
    assert _extract_low_confidence_words(html) == []


def test_real_clean_ocr_sample_at_default_threshold_returns_empty_list():
    # Captured from a real Datalab response during development.
    html = '''
    <span data-bbox="88 4 148 26" data-confidence="0.993">GCSE</span>
    <span data-bbox="155 4 224 26" data-confidence="1">English</span>
    '''
    assert _extract_low_confidence_words(html, OCR_LOW_CONFIDENCE_THRESHOLD) == []
