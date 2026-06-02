frappe.pages['pdf-uploader'].on_page_show = function(wrapper) {
    let page = $(wrapper);
    page.empty();

    // Create a clean, centered container using Frappe/Bootstrap classes
    $(`
        <div class="container-fluid">
            <div class="row justify-content-center">
                <div class="col-md-8 col-lg-6">
                    <div class="card shadow-sm">
                        <div class="card-body text-center p-5">
                            <h3 class="card-title mb-4">
                                <i class="fa fa-file-pdf-o text-danger"></i> 
                                PDF Splitter
                            </h3>
                            <p class="text-muted mb-4">
                                Upload a PDF (e.g., <code>veerpasli_2026_1-10.pdf</code>). 
                                <br>The system will automatically extract the year and page range, 
                                split the file, and create individual records.
                            </p>
                            
                            <div class="upload-area border rounded p-4 mb-4" 
                                 style="background-color: #f9fafa; border-style: dashed !important;">
                                <input type="file" id="pdfUpload" accept="application/pdf" 
                                       class="form-control" style="border: none; background: transparent;">
                            </div>

                            <button class="btn btn-primary btn-lg btn-block" id="splitBtn">
                                <i class="fa fa-scissors"></i> Split & Create Records
                            </button>
                            
                            <div id="statusMessage" class="mt-4"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `).appendTo(page);

    // Handle Button Click
    $('#splitBtn').click(function() {
        let fileInput = document.getElementById('pdfUpload');
        let $status = $('#statusMessage');
        let $btn = $(this);

        if (fileInput.files.length === 0) {
            frappe.msgprint({
                title: __('Missing File'),
                indicator: 'red',
                message: __('Please select a PDF file to proceed.')
            });
            return;
        }

        let file = fileInput.files[0];
        let reader = new FileReader();

        reader.onload = function(e) {
            let fileData = e.target.result.split(',')[1];
            
            // Disable button during processing
            $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Processing...');
            $status.empty();

            frappe.call({
                method: 'veerpasli.veerpasli.utils.pdf_splitter.split_pdf_and_create_records',
                args: {
                    file_content: fileData,
                    file_name: file.name
                },
                freeze: true,
                freeze_message: __('Splitting PDF and creating records...'),
                callback: function(r) {
                    if (r.message) {
                        $status.html(`
                            <div class="alert alert-success">
                                <i class="fa fa-check-circle"></i> 
                                <b>Success!</b> Created ${r.message} page records.
                                <br><br>
                                <a href="/app/pdf-page" class="btn btn-sm btn-success">View Records</a>
                            </div>
                        `);
                        // Reset file input
                        fileInput.value = '';
                    }
                },
                error: function(err) {
                    $status.html(`
                        <div class="alert alert-danger">
                            <i class="fa fa-exclamation-circle"></i> 
                            Error: ${err.messages ? err.messages.join(', ') : "Failed to process PDF"}
                        </div>
                    `);
                },
                always: function() {
                    // Re-enable button
                    $btn.prop('disabled', false).html('<i class="fa fa-scissors"></i> Split & Create Records');
                }
            });
        };
        reader.readAsDataURL(file);
    });
};   