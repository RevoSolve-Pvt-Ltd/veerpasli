frappe.pages['ocr-checker'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'OCR Checker',
        single_column: true
    });

    var $content = $(
        `<div class="container-fluid ocr-checker-page">
            <div class="row">
                <div class="col-12">
                    <div class="card mb-4">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                    <h5 class="card-title">OCR Checker</h5>
                                    <p class="text-muted mb-0">Open this page from a Pdf Page. The image and JSON files will load automatically and render bounding boxes.</p>
                                </div>
                                <span id="ocrCheckerSegmentCount" class="badge bg-secondary">0 segments</span>
                            </div>

                            <div id="ocrCheckerFrame" class="d-flex justify-content-center bg-light border" style="min-height: 620px;">
                                <div id="ocrCheckerImageWrapper" class="position-relative d-inline-block" style="display: none;">
                                    <img id="ocrCheckerImage" src="" class="img-fluid" />
                                    <div id="ocrCheckerOverlay" class="position-absolute" style="top: 0; left: 0; width: 100%; height: 100%;"></div>
                                </div>
                            </div>

                            <div id="ocrCheckerStatus" class="mt-3 text-muted"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
    );

    page.body.append($content);

    var $status = $content.find('#ocrCheckerStatus');
    var $segmentCount = $content.find('#ocrCheckerSegmentCount');
    var $image = $content.find('#ocrCheckerImage');
    var $imageWrapper = $content.find('#ocrCheckerImageWrapper');
    var $overlay = $content.find('#ocrCheckerOverlay');

    function setStatus(message, type) {
        $status.removeClass('text-success text-danger text-muted');
        $status.addClass(type || 'text-muted');
        $status.text(message);
    }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function clearPreview() {
        $image.attr('src', '').hide();
        $imageWrapper.hide();
        $overlay.empty();
        $segmentCount.text('0 segments');
        setStatus('Open this page from a Pdf page with image and JSON query parameters.');
    }

    function loadFromUrls(imageUrl, jsonUrl) {
        if (!imageUrl || !jsonUrl) {
            clearPreview();
            return;
        }

        setStatus('Loading image and JSON from Pdf page...', 'text-muted');
        $overlay.empty();
        $segmentCount.text('0 segments');

        fetch(jsonUrl, { credentials: 'include' })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to fetch JSON: ' + response.status);
                }
                return response.json();
            })
            .then(function(jsonData) {
                $image.off('load.autoLoad error.autoLoad');
                $image.one('load.autoLoad', function() {
                    $imageWrapper.show();
                    $image.show();
                    renderBoxes(jsonData);
                    setStatus('Rendered ' + (Array.isArray(jsonData.segments) ? jsonData.segments.length : 0) + ' boxes.', 'text-success');
                });
                $image.one('error.autoLoad', function() {
                    setStatus('Failed to load image from URL.', 'text-danger');
                });
                $image.attr('src', imageUrl);
            })
            .catch(function(error) {
                console.error(error);
                setStatus(error.message || 'Failed to load URL files. Check the browser console.', 'text-danger');
            });
    }

    function loadFromQuery() {
        var imageUrl = getQueryParam('image');
        var jsonUrl = getQueryParam('json');

        if (imageUrl && jsonUrl) {
            loadFromUrls(imageUrl, jsonUrl);
        } else {
            clearPreview();
        }
    }

    function renderBoxes(jsonData) {
        $overlay.empty();
        var imgEl = $image[0];
        var naturalWidth = imgEl.naturalWidth;
        var naturalHeight = imgEl.naturalHeight;
        if (!naturalWidth || !naturalHeight) {
            return;
        }

        var displayedWidth = imgEl.clientWidth;
        var displayedHeight = imgEl.clientHeight;
        var scaleX = displayedWidth / naturalWidth;
        var scaleY = displayedHeight / naturalHeight;

        var segments = Array.isArray(jsonData.segments) ? jsonData.segments : [];
        segments = segments.filter(function(segment) {
            return segment && segment.boundingBox;
        });

        $segmentCount.text(segments.length + ' segments');

        segments.forEach(function(segment) {
            var bb = segment.boundingBox || {};

            if (
                bb.centerPerX == null ||
                bb.centerPerY == null ||
                bb.perWidth == null ||
                bb.perHeight == null
            ) {
                return;
            }

            var left = (bb.centerPerX - bb.perWidth / 2) * 100;
            var top = (bb.centerPerY - bb.perHeight / 2) * 100;
            var boxWidth = bb.perWidth * 100;
            var boxHeight = bb.perHeight * 100;

            var $box = $(
                '<div class="ocr-box" title="' + frappe.utils.escape_html(segment.text || '') + '"></div>'
            );
            $box.css({
                position: 'absolute',
                left: left + '%',
                top: top + '%',
                width: boxWidth + '%',
                height: boxHeight + '%',
                border: '2px solid rgba(255, 0, 0, 0.75)',
                background: 'rgba(255, 0, 0, 0.10)',
                boxSizing: 'border-box',
                pointerEvents: 'auto'
            });
            $overlay.append($box);
        });
    }

    clearPreview();
    loadFromQuery();
};