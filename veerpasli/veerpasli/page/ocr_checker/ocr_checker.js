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
                            <div class="d-flex flex-column flex-md-row justify-content-between align-items-start mb-3 gap-2">
                                <div>
                                    <h5 class="card-title">OCR Checker</h5>
                                    <p class="text-muted mb-0">Open this page from a Pdf Page. The image and JSON files will load automatically and render bounding boxes.</p>
                                </div>
                                <span id="ocrCheckerSegmentCount" class="badge bg-secondary">0 segments</span>
                            </div>

                            <div id="ocrCheckerControls" class="d-flex flex-column flex-md-row align-items-start gap-2 mb-3">
                                <div class="d-flex flex-wrap gap-2">
                                    <button id="mergeBoxesBtn" class="btn btn-primary btn-sm" disabled>Merge selected</button>
                                    <button id="deleteBoxBtn" class="btn btn-danger btn-sm" disabled>Delete selected</button>
                                    <button id="clearSelectionBtn" class="btn btn-secondary btn-sm" type="button">Clear selection</button>
                                    <button id="verifyPageBtn" class="btn btn-success btn-sm d-none">Mark page verified</button>
                                </div>
                                <div class="ms-md-auto text-muted small">Selected: <span id="ocrCheckerSelectedCount">0</span></div>
                            </div>

                            <div id="ocrCheckerFrame" class="d-flex justify-content-center bg-light border" style="min-height: 620px; position: relative;">
                                <div id="ocrCheckerImageWrapper" class="position-relative d-inline-block" style="display: none; max-width: 100%;">
                                    <img id="ocrCheckerImage" src="" class="img-fluid" />
                                    <div id="ocrCheckerOverlay" class="position-absolute" style="top: 0; left: 0; width: 100%; height: 100%;"></div>
                                </div>
                            </div>

                            <div id="ocrCheckerDetails" class="card mt-3 d-none">
                                <div class="card-body"></div>
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
    var $mergeBtn = $content.find('#mergeBoxesBtn');
    var $deleteBtn = $content.find('#deleteBoxBtn');
    var $clearSelectionBtn = $content.find('#clearSelectionBtn');
    var $verifyPageBtn = $content.find('#verifyPageBtn');
    var $selectedCount = $content.find('#ocrCheckerSelectedCount');
    var $detailsCard = $content.find('#ocrCheckerDetails');
    var $detailsBody = $detailsCard.find('.card-body');

    var boxes = [];
    var nextBoxId = 0;
    var selectedBoxIds = new Set();
    var currentImageUrl = null;
    var currentJsonUrl = null;
    var jsonData = null;
    var pageId = null;

    function setStatus(message, type) {
        $status.removeClass('text-success text-danger text-muted');
        $status.addClass(type || 'text-muted');
        $status.text(message);
    }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function parseLocationFromImageUrl(imageUrl) {
        if (!imageUrl) {
            return null;
        }

        var url = imageUrl;
        try {
            url = new URL(imageUrl, window.location.origin).pathname;
        } catch (e) {
            url = imageUrl.split('?')[0];
        }

        var filename = url.split('/').pop().split('?')[0];
        filename = filename.replace(/\.[^/.]+$/, '');
        var match = filename.match(/^veerpasli_(.+)_(\d{4})[-_](\d+)$/i);
        if (match) {
            return match[1];
        }
        match = filename.match(/^veerpasli-(.+)-\d{4}-\d+$/i);
        return match ? match[1] : filename;
    }


    function initStyles() {
        if (document.getElementById('ocrCheckerStyles')) {
            return;
        }

        var style = document.createElement('style');
        style.id = 'ocrCheckerStyles';
        style.innerHTML = `
            .ocr-box { position: absolute; box-sizing: border-box; cursor: pointer; transition: border-color 0.2s ease, background-color 0.2s ease; }
            .ocr-box-original { border: 2px solid rgba(255, 0, 0, 0.75); background: rgba(255, 0, 0, 0.10); }
            .ocr-box-merged { border: 2px solid rgba(0, 123, 255, 0.75); background: rgba(0, 123, 255, 0.10); }
            .ocr-box-complete { border: 2px solid rgba(40, 167, 69, 0.85); background: rgba(40, 167, 69, 0.10); }
            .ocr-box-verified { border: 3px solid rgba(40, 167, 69, 0.95); background: rgba(40, 167, 69, 0.15); pointer-events: none; }
            .ocr-box-selected { outline: 3px solid rgba(255, 193, 7, 0.85); outline-offset: -3px; }
            .ocr-box:hover { filter: saturate(1.2); }
                .ocr-box-split-icon {
                    position: absolute;
                    top: -16px;
                    right: 4px;
                    width: 28px;
                    height: 28px;
                    border: none;
                    border-radius: 4px;
                    background: rgba(255,255,255,0.92);
                    color: #dc3545;
                    font-size: 16px;
                    line-height: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
                    z-index: 20;
                }
            .ocr-checker-field { margin-bottom: 1rem; }
            .ocr-token { display: inline-block; padding: 0.12rem 0.25rem; margin: 0 0.1rem 0.1rem 0; border-radius: 3px; transition: background-color 0.2s ease, color 0.2s ease; cursor: pointer; }
            .ocr-token-selected { background: rgba(0, 0, 0, 0.65); color: #fff; border: 1px solid transparent; padding: 0.08rem 0.18rem; border-radius: 3px; }
            .ocr-token-name.ocr-token-selected { background-color: #0d6efd; }
            .ocr-token-village.ocr-token-selected { background-color: #6610f2; }
            .ocr-token-amount.ocr-token-selected { background-color: #fd7e14; }
            .ocr-token-phone.ocr-token-selected { background-color: #198754; }
        `;
        document.head.appendChild(style);
    }

    function clearPreview() {
        $image.attr('src', '').hide();
        $imageWrapper.hide();
        $overlay.empty();
        $segmentCount.text('0 segments');
        $detailsCard.addClass('d-none');
        selectedBoxIds.clear();
        boxes = [];
        nextBoxId = 0;
        $selectedCount.text('0');
        setStatus('Open this page from a Pdf page with image and JSON query parameters.');
    }

    function createBox(segment, status) {
        return {
            id: nextBoxId++,
            text: segment.text || '',
            boundingBox: segment.boundingBox || null,
            status: segment.status || status || 'original',
            selected: false,
            mergedIds: [],
            sourceSegments: [{
                text: segment.text,
                boundingBox: segment.boundingBox
            }],
            fields: segment.fields || {
                name: '',
                village: '',
                amount: '',
                phone: ''
            }
        };
    }

    var fieldNames = ['name', 'village', 'amount', 'phone'];

    function isCompleteBox(box) {
        return box.fields.name && box.fields.village && (box.fields.amount || box.fields.phone);
    }

    function tokenizeText(text) {
        var tokens = [];
        var regex = /(\S+\s*)/g;
        var match;
        while ((match = regex.exec(text))) {
            tokens.push({
                value: match[1],
                label: match[1].trim()
            });
        }
        return tokens;
    }

    function splitBoxByTokenSelection(box, tokens, selectedTokenIds) {
        var selectedIndexes = Array.from(selectedTokenIds).sort(function(a, b) { return a - b; });
        if (!selectedIndexes.length) {
            return null;
        }
        for (var i = 1; i < selectedIndexes.length; i++) {
            if (selectedIndexes[i] !== selectedIndexes[i - 1] + 1) {
                return null;
            }
        }

        var selectedText = selectedIndexes.map(function(index) {
            return tokens[index].value;
        }).join('').trim();
        var remainingTokens = tokens.filter(function(token, index) {
            return !selectedTokenIds.has(index);
        });
        var remainingText = remainingTokens.map(function(token) {
            return token.value;
        }).join('').trim();

        if (!selectedText || !remainingText) {
            return null;
        }

        var totalLength = tokens.reduce(function(sum, token) {
            return sum + token.value.length;
        }, 0);
        var selectedLength = selectedIndexes.reduce(function(sum, index) {
            return sum + tokens[index].value.length;
        }, 0);

        var bb = box.boundingBox;
        var left = bb.centerPerX - bb.perWidth / 2;
        var selectedWidth = bb.perWidth * (selectedLength / totalLength);
        var remainingWidth = bb.perWidth - selectedWidth;
        var splitOnLeft = selectedIndexes[0] / tokens.length < 0.5;

        var boxA = {
            id: nextBoxId++,
            text: splitOnLeft ? selectedText : remainingText,
            boundingBox: {
                centerPerX: left + (splitOnLeft ? selectedWidth / 2 : remainingWidth / 2),
                centerPerY: bb.centerPerY,
                perWidth: splitOnLeft ? selectedWidth : remainingWidth,
                perHeight: bb.perHeight
            },
            sourceSegments: box.sourceSegments
                ? JSON.parse(JSON.stringify(box.sourceSegments))
                : [{
                    text: box.text,
                    boundingBox: box.boundingBox
                }],
            status: box.status,
            selected: false,
            mergedIds: box.mergedIds.slice(),
            fields: {
                name: '',
                village: '',
                amount: '',
                phone: ''
            }
        };

        var boxB = {
            id: nextBoxId++,
            text: splitOnLeft ? remainingText : selectedText,
            boundingBox: {
                centerPerX: left + (splitOnLeft ? selectedWidth + remainingWidth / 2 : remainingWidth + selectedWidth / 2),
                centerPerY: bb.centerPerY,
                perWidth: splitOnLeft ? remainingWidth : selectedWidth,
                perHeight: bb.perHeight
            },
            sourceSegments: box.sourceSegments
                ? JSON.parse(JSON.stringify(box.sourceSegments))
                : [{
                    text: box.text,
                    boundingBox: box.boundingBox
                }],
            status: box.status,
            selected: false,
            mergedIds: box.mergedIds.slice(),
            fields: {
                name: '',
                village: '',
                amount: '',
                phone: ''
            }
        };

        if (splitOnLeft) {
            return { left: boxA, right: boxB };
        }
        return { left: boxB, right: boxA };
    }

    function renderFieldLabels(box, $box) {
        fieldNames.forEach(function(field, index) {
            if (box.fields[field]) {
                var label = field.charAt(0).toUpperCase() + field.slice(1) + ': ' + box.fields[field];
                var top = 4 + index * 20;
                var $label = $('<div class="ocr-field-label"></div>').text(label).css({ top: top + 'px' });
                $box.append($label);
            }
        });
    }

    function openBoxEditorModal(box) {
        var tokens = tokenizeText(box.text || '');
        var activeField = null;
        var selectedTokenIds = new Set();
        var selectedEntryType = box.fields.entryType || 'Donation';

        function renderModalContent() {
            var html = '<div class="ocr-checker-modal">';
            html += '<div class="mb-3"><strong>Combined box text</strong></div>';
            
            var assignedTokenSet = new Set();
            for (var field in box.fields) {
                if (field !== 'entryType' && box.fields[field]) {
                    var fieldValue = box.fields[field];
                    for (var i = 0; i < tokens.length; i++) {
                        if (fieldValue.indexOf(tokens[i].value.trim()) !== -1) {
                            assignedTokenSet.add(i);
                        }
                    }
                }
            }
            var remainingTokens = tokens.filter(function(token, index) {
                return !assignedTokenSet.has(index);
            });
            
            html += '<div class="ocr-token-container mb-3" style="padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; min-height: 60px; max-height: 150px; overflow-y: auto;">';
            if (remainingTokens.length > 0) {
                remainingTokens.forEach(function(token) {
                    var originalIndex = tokens.indexOf(token);
                    var cssClass = 'ocr-token';
                    if (selectedTokenIds.has(originalIndex)) {
                        cssClass += ' ocr-token-selected';
                        if (activeField) {
                            cssClass += ' ocr-token-' + activeField;
                        }
                    }
                    html += '<span class="' + cssClass + '" data-token-index="' + originalIndex + '">' + frappe.utils.escape_html(token.value) + '</span>';
                });
            } else {
                html += '<span class="text-muted">All text has been assigned to fields.</span>';
            }
            html += '</div>';
            
            html += '<div class="mb-3"><strong>Select field</strong></div>';
            html += '<div class="d-flex flex-wrap gap-2 mb-3 align-items-center">';
            fieldNames.forEach(function(field) {
                var buttonClass = 'btn btn-sm btn-outline-primary';
                if (activeField === field) {
                    buttonClass = 'btn btn-sm btn-primary';
                }
                html += '<button type="button" class="ocr-field-select ' + buttonClass + '" data-field="' + field + '">' + field.charAt(0).toUpperCase() + field.slice(1) + '</button>';
            });
            html += '<button id="ocrCheckerAssignToken" class="btn btn-sm btn-success ms-2">Assign</button>';
            html += '<button id="ocrCheckerClearTokenSelection" class="btn btn-sm btn-secondary">Clear</button>';
            html += '</div>';
            
            html += '<div class="mb-3"><strong>Entry type</strong></div>';
            html += '<div class="d-flex flex-wrap gap-2 mb-3">';
            ['Donation', 'Collector'].forEach(function(type) {
                var buttonClass = 'btn btn-sm btn-outline-secondary';
                if (selectedEntryType === type) {
                    buttonClass = 'btn btn-sm btn-secondary active';
                }
                html += '<button type="button" class="ocr-entry-type ' + buttonClass + '" data-type="' + type + '">' + type + '</button>';
            });
            html += '</div>';
            
            html += '<div class="mb-3"><strong>Assigned fields</strong></div>';
            fieldNames.forEach(function(field) {
                html += '<div class="mb-1"><strong>' + field.charAt(0).toUpperCase() + field.slice(1) + ':</strong> ' + (box.fields[field] ? '<code>' + frappe.utils.escape_html(box.fields[field]) + '</code>' : '<span class="text-muted">not set</span>') + '</div>';
            });
            html += '</div>';
            return html;
        }

        var dialog = new frappe.ui.Dialog({
            title: 'Tag combined box text',
            fields: [
                { fieldtype: 'HTML', fieldname: 'content' }
            ]
        });

        function submitBoxEntry() {
            if (!selectedEntryType) {
                frappe.msgprint('Select Donation or Collector before submitting.');
                return;
            }

            var missing = [];
            if (!box.fields.name) {
                missing.push('name');
            }
            if (selectedEntryType === 'Donation' && !box.fields.amount) {
                missing.push('amount (for Donation)');
            }
            if (selectedEntryType === 'Collector' && !box.fields.village) {
                missing.push('village (for Collector)');
            }

            if (missing.length) {
                frappe.msgprint('Please assign the following fields: ' + missing.join(', '));
                return;
            }

            var imageUrl = currentImageUrl || getQueryParam('image');
            if (!imageUrl) {
                setStatus('Cannot determine image filename for location parsing.', 'text-danger');
                return;
            }

            dialog.set_primary_action('Submitting...', function() {});

            var entryTypeForBackend = selectedEntryType === 'Collector' ? 'collector' : 'donation';

            frappe.call({
                method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.process_ocr_box',
                args: {
                    image_url: imageUrl,
                    box: JSON.stringify({
                        type: entryTypeForBackend,
                        fields: box.fields
                    })
                },
                callback: function(r) {
                    if (r.exc) {
                        setStatus('Unable to create entry: ' + (r.exc && r.exc.message ? r.exc.message : r.message), 'text-danger');
                    } else {
                        box.status = 'verified';
                        box.fields.entryType = selectedEntryType;
                        saveVerifiedBoxToJson(box);
                        renderBoxes();
                        renderControls();
                        setStatus('Created ' + selectedEntryType + ' entry and marked as verified.', 'text-success');
                        dialog.hide();
                    }
                },
                always: function() {
                    dialog.set_primary_action('Submit', submitBoxEntry);
                }
            });
        }

        function redraw() {
            dialog.fields_dict.content.$wrapper.html(renderModalContent());
            dialog.fields_dict.content.$wrapper.find('.ocr-entry-type').on('click', function() {
                selectedEntryType = $(this).attr('data-type');
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-field-select').on('click', function() {
                activeField = $(this).attr('data-field');
                selectedTokenIds.clear();
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('.ocr-token').on('click', function() {
                if (!activeField) {
                    return;
                }
                var index = parseInt($(this).attr('data-token-index'), 10);
                if (selectedTokenIds.has(index)) {
                    selectedTokenIds.delete(index);
                } else {
                    selectedTokenIds.add(index);
                }
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerAssignToken').on('click', function() {
                if (!activeField) {
                    frappe.msgprint('Choose a field before assigning text.');
                    return;
                }
                if (!selectedTokenIds.size) {
                    frappe.msgprint('Select text tokens before assigning.');
                    return;
                }
                var assignedValue = tokens.filter(function(token, index) {
                    return selectedTokenIds.has(index);
                }).map(function(token) {
                    return token.value;
                }).join('').trim();
                var assignedField = activeField;
                box.fields[assignedField] = assignedValue;
                
                tokens = tokens.filter(function(token, index) {
                    return !selectedTokenIds.has(index);
                });
                
                activeField = null;
                selectedTokenIds.clear();
                redraw();
                renderBoxes();
                renderControls();
                setStatus('Tagged text to ' + assignedField + '.', 'text-success');
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerClearTokenSelection').on('click', function() {
                selectedTokenIds.clear();
                redraw();
            });
        }

        dialog.set_primary_action('Submit', submitBoxEntry);

        redraw();
        dialog.show();
    }

    function openSplitModal(box) {
        var tokens = tokenizeText(box.text || '');
        var selectedTokenIds = new Set();

        function renderModalContent() {
            var html = '<div class="ocr-checker-modal">';
            html += '<div class="mb-3"><strong>Split box text</strong></div>';
            html += '<div class="ocr-token-container mb-3" style="padding: 0.75rem; border: 1px solid #dee2e6; border-radius: 4px; background: #fff; max-height: 260px; overflow-y: auto;">';
            tokens.forEach(function(token, index) {
                var cssClass = 'ocr-token';
                if (selectedTokenIds.has(index)) {
                    cssClass += ' ocr-token-selected';
                }
                html += '<span class="' + cssClass + '" data-token-index="' + index + '">' + frappe.utils.escape_html(token.value) + '</span>';
            });
            html += '</div>';
            html += '<div class="mb-3 text-muted">Select the exact text you want to split into a new box, then click <strong>Split selected text</strong>.</div>';
            html += '<div class="d-flex gap-2 mb-3">';
            html += '<button id="ocrCheckerSplitOnly" class="btn btn-sm btn-warning">Split selected text</button>';
            html += '<button id="ocrCheckerClearTokenSelection" class="btn btn-sm btn-secondary">Clear selection</button>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        var dialog = new frappe.ui.Dialog({
            title: 'Split box text',
            fields: [
                { fieldtype: 'HTML', fieldname: 'content' }
            ]
        });

        function redraw() {
            dialog.fields_dict.content.$wrapper.html(renderModalContent());
            dialog.fields_dict.content.$wrapper.find('.ocr-token').on('click', function() {
                var index = parseInt($(this).attr('data-token-index'), 10);
                if (selectedTokenIds.has(index)) {
                    selectedTokenIds.delete(index);
                } else {
                    selectedTokenIds.add(index);
                }
                redraw();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerSplitOnly').on('click', function() {
                if (!selectedTokenIds.size) {
                    frappe.msgprint('Select tokens before splitting the box.');
                    return;
                }
                var splitBoxes = splitBoxByTokenSelection(box, tokens, selectedTokenIds);
                if (!splitBoxes) {
                    frappe.msgprint('Cannot split this selection into two boxes. Choose a contiguous range of tokens and try again.');
                    return;
                }

                // Remove the old box's segments from jsonData.segments
                removeSegmentForBox(box);

                box.text = splitBoxes.left.text;
                box.boundingBox = splitBoxes.left.boundingBox;
                box.sourceSegments = [{
                    text: splitBoxes.left.text,
                    boundingBox: splitBoxes.left.boundingBox
                }];

                var rightBox = splitBoxes.right;
                rightBox.sourceSegments = [{
                    text: rightBox.text,
                    boundingBox: rightBox.boundingBox
                }];

                if (jsonData && Array.isArray(jsonData.segments)) {
                    jsonData.segments.push({
                        text: box.text,
                        boundingBox: box.boundingBox
                    });
                    jsonData.segments.push({
                        text: rightBox.text,
                        boundingBox: rightBox.boundingBox
                    });
                }

                boxes.push(rightBox);
                selectedTokenIds.clear();

                // Persist the updated JSON data to the file
                persistJsonData();

                renderBoxes();
                renderControls();
                setStatus('Split the box and updated the JSON file.', 'text-success');
                dialog.hide();
            });
            dialog.fields_dict.content.$wrapper.find('#ocrCheckerClearTokenSelection').on('click', function() {
                selectedTokenIds.clear();
                redraw();
            });
        }

        dialog.set_primary_action('Done', function() {
            dialog.hide();
        });

        redraw();
        dialog.show();
    }

    function getBoxEdges(box) {
        var bb = box.boundingBox;
        var left = bb.centerPerX - bb.perWidth / 2;
        var top = bb.centerPerY - bb.perHeight / 2;
        return {
            left: left,
            top: top,
            right: left + bb.perWidth,
            bottom: top + bb.perHeight
        };
    }

    function unionBoundingBox(boxList) {
        var edges = boxList.map(getBoxEdges);
        var left = Math.min.apply(null, edges.map(function(e) { return e.left; }));
        var top = Math.min.apply(null, edges.map(function(e) { return e.top; }));
        var right = Math.max.apply(null, edges.map(function(e) { return e.right; }));
        var bottom = Math.max.apply(null, edges.map(function(e) { return e.bottom; }));

        return {
            centerPerX: (left + right) / 2,
            centerPerY: (top + bottom) / 2,
            perWidth: right - left,
            perHeight: bottom - top
        };
    }

    function sortBoxesForMerge(boxList) {
        return boxList.slice().sort(function(a, b) {
            var aEdges = getBoxEdges(a);
            var bEdges = getBoxEdges(b);
            if (Math.abs(aEdges.top - bEdges.top) > 0.01) {
                return aEdges.top - bEdges.top;
            }
            return aEdges.left - bEdges.left;
        });
    }

    function allBoxesComplete() {
        return boxes.length > 0 && boxes.every(function(box) {
            return box.status === 'complete';
        });
    }

    function removeSegmentForBox(box) {
        if (!jsonData || !Array.isArray(jsonData.segments)) {
            return false;
        }

        var removed = false;

        var segmentsToRemove = box.sourceSegments || [{
            text: box.text,
            boundingBox: box.boundingBox
        }];

        jsonData.segments = jsonData.segments.filter(function(segment) {

            var shouldRemove = segmentsToRemove.some(function(source) {

                return (
                    segment.text === source.text &&
                    JSON.stringify(segment.boundingBox) ===
                    JSON.stringify(source.boundingBox)
                );
            });

            if (shouldRemove) {
                removed = true;
                return false;
            }

            return true;
        });

        return removed;
    }

    function persistJsonData() {
        if (!pageId && currentImageUrl) {
            var filename = currentImageUrl.split('/').pop().split('?')[0];
            pageId = filename.replace(/\.[^/.]+$/, '');
        }
        if (!pageId) {
            console.error('Cannot persist: Page ID is missing.');
            return;
        }

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.update_ocr_boxes',
            args: {
                page_id: pageId,
                boxes: JSON.stringify(boxes)
            },
            callback: function(r) {
                if (r.exc) {
                    console.error('Failed to update OCR boxes:', r.exc);
                }
            }
        });
    }

    function deleteSelectedBoxes() {
        if (selectedBoxIds.size === 0) {
            return;
        }

        boxes = boxes.filter(function(box) {
            if (selectedBoxIds.has(box.id)) {
                removeSegmentForBox(box);
                return false;
            }
            return true;
        });

        selectedBoxIds.clear();
        persistJsonData();
        renderBoxes();
        renderControls();
        setStatus('Deleted selected box(es).', 'text-success');
    }

    function renderControls() {
        var selectedCount = selectedBoxIds.size;
        $selectedCount.text(selectedCount);
        $mergeBtn.prop('disabled', selectedCount < 2);
        $deleteBtn.prop('disabled', selectedCount === 0);
        $clearSelectionBtn.prop('disabled', selectedCount === 0);

        if (allBoxesVerified()) {
            $verifyPageBtn.removeClass('d-none');
        } else {
            $verifyPageBtn.addClass('d-none');
        }
    }

    function allBoxesVerified() {
        return boxes.length > 0 && boxes.every(function(box) {
            return box.status === 'verified';
        });
    }


    function onBoxClick(boxId) {
        var box = boxes.find(function(item) { return item.id === boxId; });
        if (!box) {
            return;
        }

        if (box.status === 'verified') {
            frappe.msgprint('This box has been verified and cannot be edited.');
            return;
        }

        if (box.status === 'merged' || box.status === 'complete') {
            selectedBoxIds.clear();
            boxes.forEach(function(item) { item.selected = false; });
            renderBoxes();
            renderControls();
            openBoxEditorModal(box);
            return;
        }

        box.selected = !box.selected;
        if (box.selected) {
            selectedBoxIds.add(box.id);
        } else {
            selectedBoxIds.delete(box.id);
        }

        renderBoxes();
        renderControls();
    }

    function mergeSelectedBoxes() {
        if (selectedBoxIds.size < 2) {
            return;
        }

        var selectedBoxes = boxes.filter(function(box) {
            return selectedBoxIds.has(box.id);
        });

        if (selectedBoxes.length < 2) {
            return;
        }

        selectedBoxes = sortBoxesForMerge(selectedBoxes);
        var mergedText = selectedBoxes.map(function(box) { return box.text.trim(); }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        var mergedBox = {
            id: nextBoxId++,
            text: mergedText,
            boundingBox: unionBoundingBox(selectedBoxes),
            status: 'merged',
            selected: false,
            mergedIds: selectedBoxes.map(function(box) { return box.id; }),
            sourceSegments: [],
            fields: {
                name: '',
                village: '',
                amount: '',
                phone: ''
            }
        };

        selectedBoxes.forEach(function(box) {
            if (box.sourceSegments) {
                mergedBox.sourceSegments =
                    mergedBox.sourceSegments.concat(box.sourceSegments);
            } else {
                mergedBox.sourceSegments.push({
                    text: box.text,
                    boundingBox: box.boundingBox
                });
            }
        });

        boxes = boxes.filter(function(box) {
            return !selectedBoxIds.has(box.id);
        });

        boxes.push(mergedBox);
        selectedBoxIds.clear();
        persistJsonData();
        renderBoxes();
        renderControls();
        setStatus('Merged ' + selectedBoxes.length + ' boxes.', 'text-success');
    }

    function renderBoxes() {
        $overlay.empty();
        var imgEl = $image[0];
        var naturalWidth = imgEl.naturalWidth;
        var naturalHeight = imgEl.naturalHeight;
        if (!naturalWidth || !naturalHeight) {
            return;
        }

        var segments = boxes.filter(function(box) {
            return box && box.boundingBox;
        });

        $segmentCount.text(segments.length + ' boxes');

        segments.forEach(function(box) {
            var bb = box.boundingBox;
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
                '<div class="ocr-box" title="' + frappe.utils.escape_html(box.text || '') + '"></div>'
            );
            $box.css({
                left: left + '%',
                top: top + '%',
                width: boxWidth + '%',
                height: boxHeight + '%',
                pointerEvents: box.status === 'verified' ? 'none' : 'auto'
            });

            $box.addClass(
                box.status === 'verified' ? 'ocr-box-verified' :
                box.status === 'complete' ? 'ocr-box-complete' :
                box.status === 'merged' ? 'ocr-box-merged' :
                'ocr-box-original'
            );

            if (box.selected && box.status !== 'verified') {
                $box.addClass('ocr-box-selected');
                var $splitIcon = $(
                    '<button class="ocr-box-split-icon" type="button" title="Split box">✂</button>'
                );
                $splitIcon.on('click', function(event) {
                    event.stopPropagation();
                    openSplitModal(box);
                });
                $box.append($splitIcon);
            }

            $box.on('click', function(event) {
                event.stopPropagation();
                onBoxClick(box.id);
            });

            $overlay.append($box);
        });
    }

    function saveVerifiedBoxToJson(box) {
        box.status = 'verified';
        persistJsonData();
    }

    function loadFromUrls(imageUrl, jsonUrl) {
        if (!imageUrl || !jsonUrl) {
            clearPreview();
            return;
        }

        setStatus('Loading image and JSON from Pdf page...', 'text-muted');
        $overlay.empty();
        $segmentCount.text('0 boxes');
        selectedBoxIds.clear();
        boxes = [];
        nextBoxId = 0;
        currentImageUrl = imageUrl;
        currentJsonUrl = jsonUrl;

        var filename = imageUrl.split('/').pop().split('?')[0];
        filename = filename.replace(/\.[^/.]+$/, '');
        pageId = getQueryParam('page_id') || filename;

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.get_ocr_boxes',
            args: {
                page_id: pageId
            },
            callback: function(r) {
                if (r.exc) {
                    setStatus('Failed to load OCR boxes: ' + (r.exc.message || r.message), 'text-danger');
                    return;
                }
                var data = r.message || { segments: [], verified: [] };
                jsonData = data;
                var segments = Array.isArray(data.segments) ? data.segments : [];
                var verified = Array.isArray(data.verified) ? data.verified : [];

                verified.forEach(function(verifiedBox) {
                    if (verifiedBox && verifiedBox.boundingBox) {
                        var boxObj = createBox(verifiedBox, 'verified');
                        boxObj.fields = verifiedBox.fields || boxObj.fields;
                        boxes.push(boxObj);
                    }
                });

                var verifiedKeys = verified.map(function(verifiedBox) {
                    return JSON.stringify({
                        text: verifiedBox.text,
                        boundingBox: verifiedBox.boundingBox
                    });
                });

                segments.forEach(function(segment) {
                    if (segment && segment.boundingBox) {
                        var key = JSON.stringify({
                            text: segment.text,
                            boundingBox: segment.boundingBox
                        });
                        if (verifiedKeys.indexOf(key) === -1) {
                            boxes.push(createBox(segment, 'original'));
                        }
                    }
                });

                initStyles();

                $image.off('load.autoLoad error.autoLoad');
                $image.one('load.autoLoad', function() {
                    $imageWrapper.show();
                    $image.show();
                    renderBoxes();
                    renderControls();
                    setStatus('Rendered ' + boxes.length + ' boxes (' + segments.length + ' original, ' + verified.length + ' verified).', 'text-success');
                });
                $image.one('error.autoLoad', function() {
                    setStatus('Failed to load image from URL.', 'text-danger');
                });
                $image.attr('src', imageUrl);
            }
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

    $mergeBtn.on('click', mergeSelectedBoxes);
    $deleteBtn.on('click', deleteSelectedBoxes);
    $verifyPageBtn.on('click', function() {
        if (!currentJsonUrl) {
            frappe.msgprint('JSON file URL is missing.');
            return;
        }

        frappe.call({
            method: 'veerpasli.veerpasli.doctype.pdf_page.pdf_page.mark_pdf_page_verified',
            args: {
                json_url: currentJsonUrl,
                image_url: currentImageUrl
            },
            callback: function(r) {
                if (r.exc) {
                    frappe.msgprint('Failed to mark page verified: ' + (r.exc && r.exc.message ? r.exc.message : r.message));
                } else {
                    setStatus('Pdf page marked verified.', 'text-success');
                    $verifyPageBtn.addClass('d-none');
                }
            }
        });
    });
    $clearSelectionBtn.on('click', function() {
        selectedBoxIds.clear();
        boxes.forEach(function(box) {
            box.selected = false;
        });
        renderBoxes();
        renderControls();
    });

    $(document).on('keydown.ocrChecker', function(event) {
        var key = event.key ? event.key.toLowerCase() : '';
        if ((event.ctrlKey || event.metaKey) && key === 'm') {
            event.preventDefault();
            mergeSelectedBoxes();
        }
    });

    clearPreview();
    loadFromQuery();
};